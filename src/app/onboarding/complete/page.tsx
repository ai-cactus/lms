'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Sparkle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OnboardingComplete() {
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      {/* Success Icon/Illustration */}
      <div className="relative size-[120px]">
        <div className="absolute top-5 left-5 z-[1] flex size-20 items-center justify-center rounded-full bg-primary/15">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary text-white">
            <Check className="size-6" strokeWidth={3} aria-hidden="true" />
          </div>
        </div>

        {/* Decorative Sparkles */}
        <Sparkle
          className="absolute top-0 left-1/2 size-6 -translate-x-1/2 fill-primary text-primary"
          aria-hidden="true"
        />
        <Sparkle
          className="absolute right-0 bottom-0 size-5 fill-primary text-primary"
          aria-hidden="true"
        />
        <Sparkle
          className="absolute top-2/5 -left-2.5 size-4 fill-primary text-primary"
          aria-hidden="true"
        />
      </div>

      <div className="mt-6">
        <h1 className="mb-3 text-[32px] font-bold text-foreground">
          You&apos;re all <span className="text-primary">Set!</span>
        </h1>
        <p className="max-w-[400px] text-base text-text-secondary">
          Your account has been created successfully. You can now explore the dashboard!
        </p>
      </div>

      <div className="mt-6">
        <Button onClick={() => router.push('/dashboard')} className="px-8 py-3">
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
