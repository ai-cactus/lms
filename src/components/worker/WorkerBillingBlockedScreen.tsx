'use client';

import { AlertCircle } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';

/**
 * Full-screen block shown when the worker's organization has no active billing
 * (paused or inactive subscription). Rendered in place of the portal — never a
 * redirect — so it cannot loop with the login/onboarding guards.
 */
export default function WorkerBillingBlockedScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-background-secondary p-8 text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-warning/10 text-warning">
          <AlertCircle className="size-7" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Training temporarily unavailable</h1>
        <p className="mt-3 text-sm text-text-secondary">
          Your organization&apos;s access is paused. Please contact your administrator to restore
          your training.
        </p>
        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={() => signOut({ callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/login` })}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
