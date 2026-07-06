'use client';

import { useEffect } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

interface RouteErrorBoundaryProps {
  /** The error thrown by a descendant, augmented by Next.js with a digest. */
  error: Error & { digest?: string };
  /** Re-renders the segment to attempt recovery. */
  reset: () => void;
  /** Log prefix identifying which route group caught the error, e.g. `[dashboard]`. */
  area: string;
}

/**
 * Shared, on-brand error boundary rendered by each route group's `error.tsx`.
 * Keeps the fallback UI and logging consistent across the app while letting
 * Next.js scope recovery (`reset`) to the segment that failed.
 */
export default function RouteErrorBoundary({ error, reset, area }: RouteErrorBoundaryProps) {
  useEffect(() => {
    logger.error({
      msg: `${area} Route error boundary caught error`,
      err: error,
      digest: error.digest,
    });
  }, [area, error]);

  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-error/10">
        <TriangleAlert className="size-7 text-error" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="max-w-md text-sm text-text-secondary">
          An unexpected error occurred while loading this page. You can try again, and if the
          problem keeps happening, please contact support.
        </p>
      </div>
      <Button onClick={reset}>
        <RefreshCw className="size-5" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
