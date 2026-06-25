import * as React from 'react';

import AuthHeroSlider from '@/components/auth/AuthHeroSlider';

/**
 * Split-screen auth layout: centered form column (left) + hero slider (right, lg+).
 * Replaces the per-page `.container`/`.formSection` CSS-module layout.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-background p-6 lg:p-10">
        <div className="flex w-full max-w-[420px] flex-col items-start gap-6">{children}</div>
      </div>
      <AuthHeroSlider />
    </div>
  );
}
