import * as React from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** DOM ids the pre-hydration guard script targets (see SessionIdentityGuard). */
export const SESSION_EVICTED_ROOT_ID = 'lms-session-evicted';
export const SESSION_EVICTED_NAME_ID = 'lms-session-evicted-name';

interface SessionEvictedScreenProps {
  /**
   * The account this tab WAS showing, read from per-tab sessionStorage. Shown so
   * the evicted user recognises whose view was interrupted — never the account
   * that took over the browser.
   */
  staleName?: string | null;
  /** Pre-rendered hidden for the FOUC-prevention script; React reveals it too. */
  hidden?: boolean;
}

/**
 * Neutral eviction interstitial shown when this tab's session cookie has been
 * overwritten by a different account signing in elsewhere in the same browser.
 * It renders NONE of the new account's data — only a re-auth prompt.
 *
 * Rooted in a `<header>` (not a display utility on the root, so the `hidden`
 * attribute still resolves to `display:none`; centering lives on the inner box).
 */
export function SessionEvictedScreen({ staleName, hidden }: SessionEvictedScreenProps) {
  return (
    <header
      id={SESSION_EVICTED_ROOT_ID}
      data-testid="session-evicted"
      hidden={hidden}
      suppressHydrationWarning
      className="fixed inset-0 z-[9999] bg-background"
    >
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-background-secondary p-8 text-center shadow-lg">
          <h1 className="text-headline-3 font-headline font-semibold leading-8 text-text-bold">
            You&apos;ve been signed out
          </h1>
          <Alert variant="warning" className="text-left">
            This browser is now signed in to a different account. You were viewing as{' '}
            <span
              id={SESSION_EVICTED_NAME_ID}
              className="font-semibold text-foreground"
              suppressHydrationWarning
            >
              {staleName || 'another user'}
            </span>
            . Sign in again to continue.
          </Alert>
          <Button asChild size="lg" className="w-full">
            <a href="/login">Sign in again</a>
          </Button>
        </div>
      </div>
    </header>
  );
}

export default SessionEvictedScreen;
