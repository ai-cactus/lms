'use client';

import React from 'react';
import { CheckCircle2, TriangleAlert, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type WizardToastVariant = 'success' | 'warning';

interface WizardToastProps {
  variant: WizardToastVariant;
  /** Announcement politeness — a rejected upload must interrupt, a clean one need not. */
  role?: 'status' | 'alert';
  onDismiss: () => void;
  dismissLabel: string;
  children: React.ReactNode;
  /** Inline affordances the frames put under the message, e.g. View / Dismiss. */
  actions?: React.ReactNode;
}

/**
 * The frames float every transient wizard result — PHI scan result, generation
 * quality warnings — as a dismissible card that overlaps the top bar, rather
 * than pushing the step's content down. Fixed rather than absolute: the step
 * column scrolls, and the card must not scroll away from the bar it overlaps.
 */
const VARIANT_CLASS: Record<WizardToastVariant, string> = {
  success: 'border-border bg-background',
  warning: 'border-warning/50 bg-warning/15',
};

export default function WizardToast({
  variant,
  role = 'status',
  onDismiss,
  dismissLabel,
  children,
  actions,
}: WizardToastProps) {
  const Icon = variant === 'success' ? CheckCircle2 : TriangleAlert;

  return (
    <div
      role={role}
      className={`fixed inset-x-3 top-14 z-40 flex items-start gap-3 rounded-md border px-4 py-3.5 shadow-md md:inset-x-auto md:top-[76px] md:left-[230px] md:right-[110px] md:px-5 md:py-4 ${VARIANT_CLASS[variant]}`}
    >
      <Icon
        className={`mt-0.5 size-5 shrink-0 ${variant === 'success' ? 'text-success' : 'text-warning'}`}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm leading-[1.5] text-foreground md:text-[15px]">
        {children}
        {actions && <div className="flex items-center gap-4 pt-0.5">{actions}</div>}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="-mr-1 shrink-0 text-text-secondary hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
