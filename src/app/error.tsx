'use client';

import RouteErrorBoundary from '@/components/error/RouteErrorBoundary';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} area="[app]" />;
}
