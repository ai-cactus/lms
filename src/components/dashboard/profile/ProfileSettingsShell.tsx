'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProfileNavItem<K extends string = string> {
  key: K;
  label: string;
}

interface ProfileSettingsShellProps<K extends string> {
  /** Where "Back" returns to — /dashboard for managers, /worker for learners. */
  backHref: string;
  navItems: ProfileNavItem<K>[];
  activeKey: K;
  onSelect: (key: K) => void;
  children: React.ReactNode;
}

/**
 * The Profile Settings frame from the Figma profile screens (15629:122166 and
 * siblings): a "Back" link, the page title, and a left rail of pill tabs beside
 * the active panel.
 *
 * Shared because the two profile surfaces had drifted apart. `/dashboard/profile`
 * already implemented this design, while `/worker/profile` still carried the
 * pre-redesign shell — uppercase underlined tabs on plain `div`s, at a different
 * type scale — so the SAME Change Password and 2FA panels looked wrong on the
 * worker page purely because of what surrounded them. One shell means a future
 * change to the frame cannot fix one surface and miss the other.
 *
 * The pills are real `role="tab"` buttons: the worker page's were clickable
 * `div`s, unreachable by keyboard and invisible to assistive tech.
 */
export default function ProfileSettingsShell<K extends string>({
  backHref,
  navItems,
  activeKey,
  onSelect,
  children,
}: ProfileSettingsShellProps<K>) {
  return (
    <div className="flex flex-col px-6 pt-8 pb-16 lg:px-[92px] lg:pt-10">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-2 text-base font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground lg:text-[28px]">Profile Settings</h1>

      <div className="mt-8 flex flex-col gap-6 lg:mt-10 lg:flex-row lg:gap-0">
        {/* Below lg the rail collapses to a single scrollable row of the same
            pills, so the content pane keeps the full width on small screens. */}
        <div
          role="tablist"
          aria-label="Profile settings sections"
          aria-orientation="vertical"
          className="flex shrink-0 gap-2 overflow-x-auto [scrollbar-width:none] lg:sticky lg:top-10 lg:w-[280px] lg:flex-col lg:gap-1 lg:self-start lg:overflow-visible lg:border-r lg:border-border lg:pr-6 [&::-webkit-scrollbar]:hidden"
        >
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`profile-tab-${item.key}`}
              aria-selected={activeKey === item.key}
              aria-controls="profile-section-panel"
              onClick={() => onSelect(item.key)}
              className={cn(
                'shrink-0 cursor-pointer rounded-full px-5 py-3 text-left text-base font-medium whitespace-nowrap transition-colors lg:whitespace-normal',
                activeKey === item.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-background-secondary',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="profile-section-panel"
          aria-labelledby={`profile-tab-${activeKey}`}
          className="min-w-0 flex-1 lg:pl-8"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
