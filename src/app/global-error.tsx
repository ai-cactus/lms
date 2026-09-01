'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';
import { captureClientException } from '@/lib/analytics/errors';

/**
 * Last-resort boundary for errors thrown by the ROOT layout itself.
 *
 * The route-level error.tsx files render inside the root layout, so they cannot
 * catch a failure in the layout that renders them — that case previously had no
 * boundary at all and surfaced as Next.js's default white error screen.
 *
 * Because it REPLACES the root layout, this file must supply its own <html> and
 * <body>. None of the app's providers, fonts or global styles are mounted here,
 * which is why the markup is inline rather than using the shared UI primitives:
 * anything imported from the design system would be rendering without the CSS
 * that makes it legible.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ msg: '[global] Root layout error boundary caught error', err: error });
    captureClientException(error, { area: '[global]', digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ maxWidth: '28rem', fontSize: '0.875rem', opacity: 0.8 }}>
            The application failed to load. Please try again, and contact support if the problem
            continues.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid currentColor',
              background: 'transparent',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
