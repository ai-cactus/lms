'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  TAB_IDENTITY_KEY,
  checkLiveTabIdentity,
  checkTabIdentity,
  readTabIdentity,
  writeTabIdentity,
} from '@/lib/auth/tab-identity';
import {
  SessionEvictedScreen,
  SESSION_EVICTED_ROOT_ID,
  SESSION_EVICTED_NAME_ID,
} from '@/components/auth/SessionEvictedScreen';
import { WithChildren } from '@/types/react';

interface SessionIdentityGuardProps extends WithChildren {
  /** Id of the account the server resolved for this request. */
  currentUserId?: string;
  /** Display name for that account — recorded as this tab's baseline. */
  currentUserName?: string;
}

const CONTENT_WRAPPER_ID = 'lms-session-guard-content';

/**
 * Confirm-before-evict window. When a runtime check computes a mismatch we do
 * NOT commit the eviction immediately; we wait this long, re-read the live
 * session + recorded baseline, and only evict if the mismatch STILL holds.
 *
 * A real same-portal takeover is PERSISTENT — the shared cookie genuinely
 * changed and stays changed — so it survives the re-check. Every false positive
 * we have observed is TRANSIENT: a focus-triggered `/api/auth/session` refetch
 * momentarily reading empty under CPU contention, or a reload's render still
 * in flight — each resolving to the correct value within a tick. 250ms is
 * comfortably longer than one such refetch/render race yet short enough that a
 * genuine takeover is still evicted near-instantly (and, on a genuine reload,
 * the pre-paint BlockingIdentityScript has already hidden the page regardless).
 */
const CONFIRM_EVICTION_DELAY_MS = 250;

type GuardStatus = 'pending' | 'match' | 'mismatch';

/**
 * Guards against the render-level half of the session-isolation bug: because the
 * admin/worker session cookies are shared across every tab in a browser, a
 * SECOND account signing in anywhere overwrites the cookie, and an untouched tab
 * would otherwise silently re-render as the new account on its next server round
 * trip. This compares the account the server resolved (`currentUserId`, embedded
 * in the initial HTML) against a per-TAB baseline in sessionStorage.
 *
 * On mismatch it renders NONE of the new account's data — only a neutral
 * eviction screen — and deliberately does NOT call `signOut()`: this tab never
 * owned the new account's session, so terminating it would log the new account
 * out of its own live tab.
 *
 * A synchronous inline script applies the same check before first paint (the
 * dark-mode FOUC-prevention technique) so a mismatched tab never flashes the new
 * account's view. The React effects below are the authoritative confirmation and
 * reconcile two signals: the server-resolved `currentUserId` prop (frozen at
 * render — covers mount and in-app navigation) and the LIVE `useSession()`
 * identity (refetched on window focus by the surrounding `SessionProvider` —
 * covers a cookie takeover that happens WHILE this tab is backgrounded, with no
 * reload). Either signal can only ever ESCALATE to eviction; neither downgrades
 * a CONFIRMED mismatch back to a match.
 *
 * Both runtime signals are subject to transient point-in-time races (a focus
 * refetch reading empty, a reload's render mid-flight) that momentarily look
 * like a takeover for what is actually the same valid user. To be robust to
 * that whole class rather than any single racing read, a computed mismatch is
 * NOT committed immediately: it is CONFIRMED after {@link CONFIRM_EVICTION_DELAY_MS}
 * by re-reading the live session + recorded baseline, and only then rendered as
 * an eviction. A real takeover is persistent and survives; a transient race
 * resolves to a match and no eviction happens.
 *
 * Layouts that do not supply `currentUserId` (auth, onboarding, wizard, viewer)
 * opt out of guarding entirely.
 */
export function SessionIdentityGuard({
  currentUserId,
  currentUserName,
  children,
}: SessionIdentityGuardProps) {
  const pathname = usePathname();
  const { data: session, status: sessionStatus } = useSession();
  const [status, setStatus] = React.useState<GuardStatus>('pending');
  const [staleName, setStaleName] = React.useState<string | null>(null);

  // The confirmation timer's recheck (see scheduleEvictionConfirmation) runs
  // ~250ms after a mismatch is first seen and must consult the FRESHEST live
  // session — not the value captured when the mismatch was computed — because
  // the transient we guard against is exactly a stale/empty in-flight read
  // resolving to its true value in that window. Refs give the async timer a live
  // view of state that React only exposes to it as a frozen closure.
  const sessionRef = React.useRef(session);
  const sessionStatusRef = React.useRef(sessionStatus);
  React.useEffect(() => {
    sessionRef.current = session;
    sessionStatusRef.current = sessionStatus;
  });

  const confirmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingConfirmation = React.useCallback(() => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  // A check just saw this tab as its OWN valid user. Commit the match and drop
  // any in-flight eviction confirmation — a positive match retroactively proves
  // a still-pending mismatch was the transient race we guard against. Never
  // downgrade an ALREADY-CONFIRMED mismatch though: eviction is escalate-only.
  const resolveMatch = React.useCallback(() => {
    clearPendingConfirmation();
    setStatus((prev) => (prev === 'mismatch' ? 'mismatch' : 'match'));
  }, [clearPendingConfirmation]);

  // Confirm-before-evict. A runtime check computed a mismatch; don't commit the
  // eviction yet. Wait one short window, re-run `recheck` (which re-reads the
  // live session + recorded baseline afresh), and only render the eviction if it
  // STILL mismatches. A single shared timer debounces overlapping checks so they
  // never double-fire — the latest schedule wins, and since every schedule
  // points at the same underlying takeover, whichever survives re-confirms it.
  //
  // No data leak during the wait: in the false-positive case it is the same
  // user, so there is nothing to leak. In a genuine FOCUS-path takeover (no
  // reload/navigation) the tab never re-rendered, so what is on screen is the
  // ORIGINAL user's own stale page — never the takeover account's data. The
  // genuine reload path is separately no-flash: BlockingIdentityScript hides the
  // page pre-paint from the STABLE server-rendered id, before this delay applies.
  const scheduleEvictionConfirmation = React.useCallback(
    (recheck: () => { mismatch: boolean; staleName: string | null }) => {
      clearPendingConfirmation();
      confirmTimerRef.current = setTimeout(() => {
        confirmTimerRef.current = null;
        const confirmed = recheck();
        if (confirmed.mismatch) {
          setStaleName(confirmed.staleName);
          setStatus('mismatch');
        } else {
          // Transient race — the tab is still its own valid user. Reveal
          // content, but never downgrade an already-confirmed mismatch.
          setStatus((prev) => (prev === 'mismatch' ? 'mismatch' : 'match'));
        }
      }, CONFIRM_EVICTION_DELAY_MS);
    },
    [clearPendingConfirmation],
  );

  // Prop-based check: the account the server resolved for this request. Owns the
  // `first-sight` baseline and catches the reload / in-app-navigation takeover
  // path (a fresh server render carries a fresh prop).
  const evaluate = React.useCallback(() => {
    if (!currentUserId) return;
    const recorded = readTabIdentity();
    const result = checkTabIdentity(recorded, currentUserId);
    if (result === 'first-sight') {
      writeTabIdentity({ userId: currentUserId, name: currentUserName ?? '' });
      resolveMatch();
    } else if (result === 'match') {
      resolveMatch();
    } else {
      // `currentUserId` is a stable server-rendered prop, so the re-read only
      // reconfirms against a fresh recorded baseline. Keep the recorded (stale)
      // identity so the screen can name who this tab WAS showing; never adopt
      // the account that took over the cookie.
      scheduleEvictionConfirmation(() => {
        const fresh = readTabIdentity();
        return {
          mismatch: checkTabIdentity(fresh, currentUserId) === 'mismatch',
          staleName: fresh?.name ?? null,
        };
      });
    }
  }, [currentUserId, currentUserName, resolveMatch, scheduleEvictionConfirmation]);

  // Live-session check: the `currentUserId` prop is frozen at server render, so
  // it cannot see a cookie takeover that happens WHILE this tab is backgrounded.
  // `useSession()` — refetched on window focus by the surrounding SessionProvider
  // — reports what the shared cookie resolves to right now, so a takeover
  // detected here evicts the tab without a reload/navigation. It only ever
  // escalates: `match`/`unknown` must not downgrade a mismatch.
  const evaluateLive = React.useCallback(() => {
    if (!currentUserId) return;
    // Evict ONLY on positive evidence of a different authenticated account. A
    // non-`authenticated` status (`unauthenticated`/`loading`) is NOT a takeover:
    // under CPU contention the focus-triggered `/api/auth/session` refetch can
    // momentarily read empty for a still-valid session, and treating that as a
    // mismatch spuriously evicts (a spontaneous logout). A genuine logout/expiry
    // is handled by the proxy redirect on the next request, not by this guard —
    // which exists specifically to catch a SAME-PORTAL takeover (always
    // `authenticated` + a different id).
    if (sessionStatus !== 'authenticated') return;
    const recorded = readTabIdentity();
    const liveUserId = session?.user?.id ?? null;
    if (checkLiveTabIdentity(recorded, liveUserId) !== 'mismatch') return;
    // Confirm against the FRESHEST session/baseline, not the values captured
    // here: the false positive we guard against is precisely an in-flight
    // session read that resolves correctly a tick later, so the recheck must
    // consult current state via refs to see it settle.
    scheduleEvictionConfirmation(() => {
      const freshRecorded = readTabIdentity();
      const freshLiveUserId = sessionRef.current?.user?.id ?? null;
      const stillMismatch =
        sessionStatusRef.current === 'authenticated' &&
        checkLiveTabIdentity(freshRecorded, freshLiveUserId) === 'mismatch';
      return { mismatch: stillMismatch, staleName: freshRecorded?.name ?? null };
    });
  }, [currentUserId, sessionStatus, session, scheduleEvictionConfirmation]);

  // Confirm on mount and on every in-app navigation — layouts persist across
  // sibling routes, so a pathname change is the client-nav equivalent of a
  // fresh server render.
  React.useEffect(() => {
    evaluate();
  }, [evaluate, pathname]);

  // Re-run the live check whenever the refetched session changes AND on
  // focus/visibility. The focus-triggered refetch is async, so the session-change
  // dependency is what actually catches a takeover once the refetch resolves.
  React.useEffect(() => {
    evaluateLive();
  }, [evaluateLive]);

  // Drop any in-flight confirmation on unmount so its timer never fires a
  // setState against a torn-down component.
  React.useEffect(() => clearPendingConfirmation, [clearPendingConfirmation]);

  React.useEffect(() => {
    if (!currentUserId) return;
    const onFocus = () => evaluateLive();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') evaluateLive();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [evaluateLive, currentUserId]);

  if (!currentUserId) {
    return <>{children}</>;
  }

  return (
    <>
      {status !== 'match' && (
        <SessionEvictedScreen staleName={staleName} hidden={status === 'pending'} />
      )}
      {status !== 'mismatch' && (
        <div id={CONTENT_WRAPPER_ID} style={{ display: 'contents' }} suppressHydrationWarning>
          {children}
        </div>
      )}
      <BlockingIdentityScript
        currentUserId={currentUserId}
        currentUserName={currentUserName ?? ''}
      />
    </>
  );
}

// Embed a value into an inline <script> safely. JSON.stringify alone does NOT
// neutralise `</script>` or the JS line separators U+2028/U+2029, and the name
// here is user-controlled (fullName) — so escape the sequences that could break
// out of the script context.
function serializeForScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Synchronous, render-blocking inline script (NOT next/script \u2014 no async/defer):
 * runs during initial HTML parse, before the tree paints, so a mismatched tab
 * reveals the pre-rendered-hidden eviction screen and hides the content instead
 * of flashing the new account's view. Idempotent and fully guarded; the React
 * effect above is the authoritative check.
 */
function BlockingIdentityScript({
  currentUserId,
  currentUserName,
}: {
  currentUserId: string;
  currentUserName: string;
}) {
  const js = `(function(){try{
var KEY=${serializeForScript(TAB_IDENTITY_KEY)};
var CURRENT=${serializeForScript(currentUserId)};
var NAME=${serializeForScript(currentUserName)};
var raw;try{raw=sessionStorage.getItem(KEY)}catch(e){return}
var recorded=null;if(raw){try{recorded=JSON.parse(raw)}catch(e){recorded=null}}
if(!recorded||typeof recorded.userId!=='string'){
try{sessionStorage.setItem(KEY,JSON.stringify({userId:CURRENT,name:NAME}))}catch(e){}
return}
if(recorded.userId===CURRENT)return;
var content=document.getElementById(${JSON.stringify(CONTENT_WRAPPER_ID)});
if(content){content.style.display='none'}
var screen=document.getElementById(${JSON.stringify(SESSION_EVICTED_ROOT_ID)});
if(screen){screen.hidden=false}
var nameEl=document.getElementById(${JSON.stringify(SESSION_EVICTED_NAME_ID)});
if(nameEl&&typeof recorded.name==='string'&&recorded.name){nameEl.textContent=recorded.name}
}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

export default SessionIdentityGuard;
