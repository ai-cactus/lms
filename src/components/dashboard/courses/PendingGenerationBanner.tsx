'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { checkCourseGenerationJobV46 } from '@/app/actions/course-ai-v4.6';
import { cn } from '@/lib/utils';

const PENDING_KEY = 'lms_pending_generation';
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

interface PendingGeneration {
  jobId: string;
  formData: Record<string, unknown>;
  timestamp: number;
}

type BannerState = 'generating' | 'done' | 'failed' | 'hidden';

const bannerClasses: Record<Exclude<BannerState, 'hidden'>, string> = {
  generating: 'border-primary/30 bg-primary/5 text-foreground',
  done: 'border-success/30 bg-success/10 text-foreground',
  failed: 'border-error/30 bg-error/10 text-foreground',
};

export default function PendingGenerationBanner() {
  const [banner, setBanner] = useState<BannerState>('hidden');
  const [pending, setPending] = useState<PendingGeneration | null>(null);

  const dismiss = useCallback(() => {
    localStorage.removeItem(PENDING_KEY);
    setBanner('hidden');
  }, []);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PENDING_KEY);
    } catch {
      return; // localStorage unavailable
    }
    if (!raw) return;

    let parsed: PendingGeneration;
    try {
      parsed = JSON.parse(raw) as PendingGeneration;
    } catch {
      localStorage.removeItem(PENDING_KEY);
      return;
    }

    // Discard entries older than 1 hour
    if (Date.now() - parsed.timestamp > STALE_THRESHOLD_MS) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: initialising banner state from localStorage inside effect
    setPending(parsed);

    setBanner('generating');

    const interval = setInterval(async () => {
      try {
        const res = await checkCourseGenerationJobV46(parsed.jobId);
        if (res.status === 'completed') {
          clearInterval(interval);
          setBanner('done');
        } else if (res.status === 'failed' || res.error) {
          clearInterval(interval);
          setBanner('failed');
        }
      } catch {
        // network blip — keep polling
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  if (banner === 'hidden' || !pending) return null;

  return (
    <div
      className={cn(
        'mb-4 flex items-center gap-3 rounded-[10px] border px-4 py-3 text-sm',
        bannerClasses[banner],
      )}
    >
      {banner === 'generating' && (
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
      )}
      {banner === 'done' && (
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
      )}
      {banner === 'failed' && (
        <AlertTriangle className="size-4 shrink-0 text-error" aria-hidden="true" />
      )}
      <span className="flex-1">
        {banner === 'generating' && 'Your course is still being generated in the background…'}
        {banner === 'done' &&
          'Course generation complete! Resume the wizard to review and publish.'}
        {banner === 'failed' && 'Course generation failed. Please start a new course.'}
      </span>
      {banner === 'done' && (
        <Link
          href="/dashboard/courses/create"
          className="font-semibold whitespace-nowrap text-success no-underline"
        >
          Resume Setup →
        </Link>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="cursor-pointer border-none bg-none p-1 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
