/**
 * Per-TAB identity baseline for the session-isolation guard.
 *
 * `sessionStorage` is scoped to a single browser tab, whereas the NextAuth
 * session cookie is shared across every tab in the browser. Recording which
 * account a tab first rendered as — in sessionStorage — lets each tab detect
 * when the shared cookie has since been overwritten by a DIFFERENT account
 * signing in elsewhere (see SessionIdentityGuard). That is the render-level half
 * of the session-isolation fix: cookies alone cannot tell one tab apart from
 * another, so the detection state must live per tab.
 *
 * Kept dependency-free and framework-agnostic so it is safe to import from both
 * the pre-hydration inline guard script and the React guard component.
 */

export const TAB_IDENTITY_KEY = 'lms.tab-identity';

export interface TabIdentity {
  userId: string;
  name: string;
}

export type TabIdentityCheck = 'first-sight' | 'match' | 'mismatch';

export function readTabIdentity(): TabIdentity | null {
  try {
    const raw = sessionStorage.getItem(TAB_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TabIdentity> | null;
    if (!parsed || typeof parsed.userId !== 'string' || typeof parsed.name !== 'string') {
      return null;
    }
    return { userId: parsed.userId, name: parsed.name };
  } catch {
    // sessionStorage unavailable (private mode, disabled) or malformed JSON —
    // the guard degrades to "first-sight" rather than throwing.
    return null;
  }
}

export function writeTabIdentity(identity: TabIdentity): void {
  try {
    sessionStorage.setItem(TAB_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* sessionStorage unavailable — guard degrades to a no-op */
  }
}

export function clearTabIdentity(): void {
  try {
    sessionStorage.removeItem(TAB_IDENTITY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pure comparison of a tab's recorded baseline against the account the server
 * just resolved for this request.
 *
 * - `first-sight` — the tab has recorded nothing yet (fresh tab): the caller
 *   should record the current identity as its baseline.
 * - `match`       — the tab's baseline still matches the live session.
 * - `mismatch`    — the shared cookie now belongs to a DIFFERENT account than
 *   the one this tab was showing: the tab must be evicted, not silently swapped.
 */
export function checkTabIdentity(
  recorded: TabIdentity | null,
  currentUserId: string,
): TabIdentityCheck {
  if (!recorded) return 'first-sight';
  return recorded.userId === currentUserId ? 'match' : 'mismatch';
}

export type LiveTabIdentityCheck = 'match' | 'mismatch' | 'unknown';

/**
 * Pure comparison of a tab's recorded baseline against the LIVE session identity
 * — what the shared cookie resolves to RIGHT NOW — used by the on-focus re-check.
 *
 * Unlike {@link checkTabIdentity} this never establishes a baseline: when the tab
 * has recorded nothing yet the result is `unknown` and the caller must do nothing
 * (the server-prop path owns the `first-sight` transition).
 *
 * `mismatch` requires POSITIVE evidence of a different account: a recorded
 * baseline AND a present live id that differs from it. An absent live id
 * (`null`/`undefined`/empty) resolves to `unknown`, NOT `mismatch` — a bare
 * unauthenticated read is not proof of a takeover (under CPU contention the
 * on-focus `/api/auth/session` refetch can momentarily return empty for a
 * still-valid session, which must never evict). A genuine logout/expiry/
 * cross-portal cookie deletion is not this guard's job: the proxy redirects to
 * `/login` on the next request. This guard exists to catch a SAME-PORTAL
 * takeover, which is always authenticated with a different id.
 */
export function checkLiveTabIdentity(
  recorded: TabIdentity | null,
  liveUserId: string | null | undefined,
): LiveTabIdentityCheck {
  if (!recorded) return 'unknown';
  if (!liveUserId) return 'unknown';
  return liveUserId === recorded.userId ? 'match' : 'mismatch';
}
