'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Marks the throwaway history entry this guard parks in front of the page's real
 * one.
 *
 * Next.js patches `history.pushState` to copy its own `__NA` and
 * `__PRIVATE_NEXTJS_INTERNALS_TREE` keys onto whatever state object is passed
 * (`next/dist/client/components/app-router.js`), so the sentinel still pops as a
 * client-side traversal. Without those keys app-router's popstate handler takes
 * the `window.location.reload()` branch it reserves for foreign entries.
 */
const GUARD_HISTORY_STATE_KEY = '__lmsUnsavedChangesGuard';

export interface UnsavedChangesBackGuard {
  /**
   * Park a fresh sentinel after a cancelled exit, so the next Back press is
   * caught the same way. A no-op while one is already parked, which makes it
   * safe to call from a dialog's generic close handler.
   */
  rearm: () => void;
}

export interface UseUnsavedChangesBackGuardOptions {
  /** Arm only while there is genuinely something to lose. */
  enabled: boolean;
  /**
   * Called once a Back press has been absorbed — open the confirmation here.
   * `leave` completes the absorbed press; call it only if the user confirms.
   */
  onIntercept: (leave: () => void) => void;
}

/**
 * Catches the browser Back button on a page holding unsaved work.
 *
 * ⚠️ Next.js 16 has **no** navigation-blocking API. `<Link onNavigate>` can
 * cancel a link click and `beforeunload` covers tab close and reload, but the
 * App Router serves Back as a client-side `popstate` that neither one observes
 * and that cannot be cancelled. So this intercepts the history stack directly:
 * a deliberate workaround, not a supported mechanism, and worth re-checking
 * whenever Next ships a real blocker.
 *
 * The mechanism is one throwaway history entry for the *current* URL, parked in
 * front of the real one. Back spends that entry — the URL never changes, so the
 * page is not navigated and component state survives — the caller confirms, and
 * `leave()` performs the one remaining step for real.
 *
 * ⛔ It never re-pushes while the confirmation is open. A guard that reinstates
 * its entry on every Back press can leave someone unable to leave the page at
 * all, which is worse than losing the edits. The failure mode here is the
 * opposite one, and the deliberate choice: an insistent second Back press
 * leaves without waiting for an answer.
 */
export function useUnsavedChangesBackGuard({
  enabled,
  onIntercept,
}: UseUnsavedChangesBackGuardOptions): UnsavedChangesBackGuard {
  const onInterceptRef = useRef(onIntercept);
  useEffect(() => {
    onInterceptRef.current = onIntercept;
  });

  /**
   * Whether an unspent sentinel is sitting in the history stack. It tracks the
   * stack rather than the effect, so a save-then-edit-again cycle reuses the
   * entry already pushed instead of stacking a second one.
   */
  const isArmedRef = useRef(false);

  /** Set once the guard has released a real Back: nothing may re-arm after it. */
  const hasLeftRef = useRef(false);

  const arm = useCallback(() => {
    if (hasLeftRef.current || isArmedRef.current) return;
    // Nothing behind this page means Back is already inert. Pushing a sentinel
    // would invent a Back target whose confirmation could then lead nowhere —
    // a prompt that resolves to staying put is the trap this guard must avoid.
    if (window.history.length <= 1) return;

    window.history.pushState({ [GUARD_HISTORY_STATE_KEY]: true }, '');
    isArmedRef.current = true;
  }, []);

  const leave = useCallback(() => {
    hasLeftRef.current = true;
    isArmedRef.current = false;
    // One step, because the sentinel was already spent by the press that got
    // us here — so this lands on the entry the user actually aimed at.
    window.history.back();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    arm();

    const handlePopState = () => {
      if (!isArmedRef.current) return;

      // Spent. The browser now sits on the page's real entry, one step from
      // leaving for real, and this handler adds nothing back. A second press
      // therefore finds no guard and simply leaves.
      isArmedRef.current = false;
      onInterceptRef.current(leave);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [enabled, arm, leave]);

  return { rearm: arm };
}
