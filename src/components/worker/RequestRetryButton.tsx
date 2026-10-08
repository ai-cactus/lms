'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { requestCourseRetry } from '@/app/actions/enrollment';
import { retryRequestUiState } from '@/lib/enrollment/retry-request';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

const REQUEST_FALLBACK = 'We could not send your retry request. Please try again.';

interface RequestRetryButtonProps {
  enrollmentId: string;
  status: string;
  retryRequestedAt?: Date | string | null;
  /** `compact` fits a table cell: a small link-style action and no explanation line. */
  compact?: boolean;
  /**
   * Render nothing once a request is pending — for a surface that already says
   * so elsewhere (the course list's status column).
   */
  hideWhenPending?: boolean;
  /** For a dark surface (the course hero): light text, and an opaque refusal box. */
  inverse?: boolean;
  className?: string;
}

/**
 * Q-35: a learner locked out of a course asks their admins for a retake. Shows
 * "Request retry" while one may be sent, and "Retry requested" while a request
 * stands (72 hours, then the learner may ask again). Renders nothing for an
 * enrolment that is not locked.
 */
export default function RequestRetryButton({
  enrollmentId,
  status,
  retryRequestedAt,
  compact = false,
  hideWhenPending = false,
  inverse = false,
  className,
}: RequestRetryButtonProps) {
  const router = useRouter();
  const [requestedAt, setRequestedAt] = useState<Date | string | null>(retryRequestedAt ?? null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const state = retryRequestUiState({ status, retryRequestedAt: requestedAt });
  if (state === 'none') return null;

  if (state === 'pending') {
    if (hideWhenPending) return null;
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-sm font-semibold',
            inverse ? 'text-white' : 'text-text-secondary',
          )}
        >
          <Clock className="size-4" aria-hidden="true" />
          Retry requested
        </span>
        {!compact && (
          <p className={cn('text-xs', inverse ? 'text-white/70' : 'text-text-tertiary')}>
            Your admin has been notified and can assign you a retake.
          </p>
        )}
      </div>
    );
  }

  const handleRequest = () => {
    setError('');
    startTransition(async () => {
      try {
        const result = await requestCourseRetry(enrollmentId);
        if (!result.success) {
          setError(result.refusedReason ?? REQUEST_FALLBACK);
          return;
        }
        setRequestedAt(result.requestedAt ?? new Date().toISOString());
        router.refresh();
      } catch (err) {
        logger.error({ msg: '[worker] Failed to request a course retry', err, enrollmentId });
        setError(REQUEST_FALLBACK);
      }
    });
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Button
        type="button"
        variant={compact ? 'link' : 'default'}
        size={compact ? 'xs' : 'default'}
        className={compact ? 'h-auto px-1 font-semibold text-error' : undefined}
        loading={pending}
        onClick={handleRequest}
      >
        {!compact && <RotateCcw aria-hidden="true" />}
        Request retry
      </Button>
      {error && (
        <Alert variant="error" className={inverse ? 'max-w-xs bg-background' : undefined}>
          {error}
        </Alert>
      )}
    </div>
  );
}
