'use client';

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';

interface InactivityTimerProps {
  /** Minutes of inactivity before auto-logout. Must match server-side config. */
  timeoutMinutes?: number;
  /** Minutes before expiry to show the warning modal. Default: 2 */
  warningMinutes?: number;
  /** API path to ping for keep-alive (e.g. '/api/auth/keep-alive') */
  keepAlivePath: string;
}

/**
 * Client-side inactivity timer.
 *
 * - Tracks user activity (mouse, keyboard, scroll, touch).
 * - Shows a warning modal N minutes before the session expires.
 * - Offers a "Stay Logged In" button that pings a keep-alive endpoint.
 * - Auto-redirects to login when the session expires.
 *
 * The server-side JWT callback is the authoritative enforcer — this component
 * is a UX enhancement that gives users a chance to extend their session.
 */
export default function InactivityTimer({
  timeoutMinutes = parseInt(process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES || '15', 10),
  warningMinutes = 2,
  keepAlivePath,
}: InactivityTimerProps) {
  const { data: session } = useSession();
  const [showWarning, setShowWarning] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);

  const lastActivityRef = useRef<number>(0);
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
      const res = await fetch(keepAlivePath, { method: 'GET', credentials: 'same-origin' });
      if (res.ok) {
        resetActivity();
      } else {
        // Session already expired server-side
        window.location.href = '/login?reason=inactive';
      }
    } catch {
      // Network error — don't log out for this
      resetActivity();
    }
  }, [keepAlivePath, resetActivity]);

  const handleLogout = useCallback(() => {
    signOut({ callbackUrl: '/login?reason=inactive' });
  }, []);

  // Track user activity
  useEffect(() => {
    if (!session) return;

    // Initialize on mount
    if (lastActivityRef.current === 0) {
      lastActivityRef.current = Date.now();
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

  // Main timer that checks inactivity
  useEffect(() => {
    if (!session) return;

    const checkInterval = 30_000; // Check every 30 seconds

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed >= TIMEOUT_MS) {
        // Session expired — redirect
        handleLogout();
        return;
      }

      if (elapsed >= WARNING_MS && !showWarning) {
        // Show warning
        const remainingMs = TIMEOUT_MS - elapsed;
        setCountdownSeconds(Math.ceil(remainingMs / 1000));
        setShowWarning(true);

        // Start countdown
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
      }
    }, checkInterval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [session, TIMEOUT_MS, WARNING_MS, showWarning, handleLogout]);

  if (!session || !showWarning) return null;

  const minutes = Math.floor(countdownSeconds / 60);
  const seconds = countdownSeconds % 60;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '420px',
          width: '90%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          textAlign: 'center',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            backgroundColor: '#FEF3C7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D97706"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: '#111827' }}>
          Session Expiring Soon
        </h3>
        <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '8px' }}>
          You have been inactive for a while. Your session will expire in:
        </p>
        <p
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: countdownSeconds < 60 ? '#EF4444' : '#D97706',
            marginBottom: '24px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {minutes}:{seconds.toString().padStart(2, '0')}
        </p>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleLogout}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #D1D5DB',
              backgroundColor: '#fff',
              color: '#374151',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Log Out
          </button>
          <button
            onClick={handleKeepAlive}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#2563EB',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Stay Logged In
          </button>
        </div>
      </div>
    </div>
  );
}
