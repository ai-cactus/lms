'use client';

import { useEffect, useCallback, useRef, useState, FC } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  /** Minutes before expiry to show the warning modal. Default: 2 */
  warningMinutes?: number;
}

/**
 * Client-side inactivity timer.
 *
 * - Tracks user activity (mouse, keyboard, scroll, touch).
 * - Shows a warning modal N minutes before the session expires.
 * - Offers a "Stay Logged In" button that pings a keep-alive endpoint.
 * - Auto-redirects to login when the session expires.
 *
 * The idle window comes from `session.user.inactivityTimeoutMinutes` (stamped on
 * the JWT at sign-in from `INACTIVITY_TIMEOUT_MINUTES`), so the client and the
 * server-side JWT `maxAge` agree on a single value. The server callback remains
 * the authoritative enforcer — this component is a UX enhancement.
 */
export const InactivityTimer: FC<Props> = ({ warningMinutes = 2 }) => {
  const { data: session, update } = useSession();
  const [showWarning, setShowWarning] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);

  // Fall back to 60 only for the brief pre-session window / legacy tokens that
  // predate the stamped claim; a live session always carries the resolved value.
  const timeoutMinutes = session?.user?.inactivityTimeoutMinutes ?? 60;

  const lastActivityRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const TIMEOUT_MS = timeoutMinutes * 60 * 1000;
  const WARNING_MS = (timeoutMinutes - warningMinutes) * 60 * 1000;

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const handleKeepAlive = useCallback(async () => {
    try {
      await update();
      resetActivity();
      lastUpdateRef.current = Date.now();
    } catch {
      // Network error or session already expired — sign out cleanly
      try {
        sessionStorage.setItem('logout_reason', 'inactive');
      } catch {
        /* ignore */
      }
      window.location.href = '/login';
    }
  }, [update, resetActivity]);

  const handleLogout = useCallback(() => {
    try {
      sessionStorage.setItem('logout_reason', 'inactive');
    } catch {
      /* ignore */
    }
    signOut({ callbackUrl: '/login' });
  }, []);

  // The elapsed-time check, shared by the polling interval and the
  // visibilitychange listener so a tab returning to the foreground re-evaluates
  // immediately instead of waiting up to a full poll cycle.
  const checkElapsed = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastActivityRef.current;

    if (elapsed >= TIMEOUT_MS) {
      handleLogout();
      return;
    }

    if (elapsed >= WARNING_MS && !showWarning) {
      const remainingMs = TIMEOUT_MS - elapsed;
      setCountdownSeconds(Math.ceil(remainingMs / 1000));
      setShowWarning(true);

      countdownRef.current = setInterval(() => {
        setCountdownSeconds((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            handleLogout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (
      !showWarning &&
      lastActivityRef.current > lastUpdateRef.current &&
      now - lastUpdateRef.current >= 4 * 60 * 1000
    ) {
      // Heartbeat: If user is active, silently update session every 4 minutes
      update().catch(() => {});
      lastUpdateRef.current = now;
    }
  }, [TIMEOUT_MS, WARNING_MS, showWarning, handleLogout, update]);

  useEffect(() => {
    if (!session) return;

    if (lastActivityRef.current === 0) {
      lastActivityRef.current = Date.now();
    }
    if (lastUpdateRef.current === 0) {
      lastUpdateRef.current = Date.now();
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    const handler = () => {
      lastActivityRef.current = Date.now();
    };

    for (const event of events) {
      document.addEventListener(event, handler, { passive: true });
    }

    return () => {
      for (const event of events) {
        document.removeEventListener(event, handler);
      }
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const checkInterval = 30_000;
    timerRef.current = setInterval(checkElapsed, checkInterval);

    // Re-check the moment a backgrounded tab is refocused — timers throttle
    // heavily while hidden, so the session may already be past expiry.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkElapsed();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session, checkElapsed]);

  if (!session || !showWarning) return null;

  const minutes = Math.floor(countdownSeconds / 60);
  const seconds = countdownSeconds % 60;

  return (
    <Dialog open={showWarning}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md text-center"
      >
        <DialogHeader className="items-center text-center sm:text-center">
          <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-warning/10">
            <Clock className="size-6 text-warning" aria-hidden="true" />
          </span>
          <DialogTitle>Session Expiring Soon</DialogTitle>
          <DialogDescription>
            You have been inactive for a while. Your session will expire in:
          </DialogDescription>
        </DialogHeader>

        <p
          className={`text-3xl font-bold tabular-nums ${
            countdownSeconds < 60 ? 'text-error' : 'text-warning'
          }`}
        >
          {minutes}:{seconds.toString().padStart(2, '0')}
        </p>

        <DialogFooter className="sm:justify-center">
          <Button variant="outline" className="flex-1" onClick={handleLogout}>
            Log Out
          </Button>
          <Button className="flex-1" onClick={handleKeepAlive}>
            Stay Logged In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InactivityTimer;
