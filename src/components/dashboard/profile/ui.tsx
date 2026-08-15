import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const EM_DASH = '—';

/** Bordered panel used for every read-view block on Profile Settings. */
export function PanelCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('rounded-2xl border border-border bg-background p-6', className)}>
      {children}
    </section>
  );
}

/** Read-only label-over-value pair; an empty value reads as an em dash. */
export function ReadField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-base font-semibold break-words text-foreground">
        {value?.trim() ? value : EM_DASH}
      </span>
    </div>
  );
}

/** Icon + label + value row used on the facility cards. */
export function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="w-32 shrink-0 text-text-secondary sm:w-40">{label}</span>
      <span className="shrink-0 text-text-secondary">:</span>
      <span className="min-w-0 break-words text-foreground">{value?.trim() ? value : EM_DASH}</span>
    </div>
  );
}

/** Two-letter monogram for a facility avatar. */
export function facilityInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
