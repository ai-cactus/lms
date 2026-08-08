import React from 'react';
import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MetricCardData {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Background utility for the icon medallion (the metric's accent colour). */
  iconSurface: string;
  /** Percentage movement vs. the previous month; null renders no chip. */
  trendPercent: number | null;
  /** Whether a rise is good news — decides the chip's colour, not its arrow. */
  higherIsBetter: boolean;
  /** Risk figures are rendered in the error tone to match the design. */
  tone?: 'default' | 'critical';
}

interface MetricGroupProps {
  title: string;
  metrics: MetricCardData[];
}

function TrendChip({
  trendPercent,
  higherIsBetter,
}: Pick<MetricCardData, 'trendPercent' | 'higherIsBetter'>) {
  if (trendPercent === null) return null;

  const rising = trendPercent >= 0;
  const favourable = rising === higherIsBetter;
  const Icon = rising ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap',
        favourable ? 'text-success' : 'text-error',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span className="font-semibold">{Math.abs(trendPercent)}%</span>
      <span className="hidden text-text-secondary sm:inline">from last month</span>
    </span>
  );
}

/**
 * One titled band of the Global View — a header strip plus a row of metric
 * cards. The `gap-px` over a `bg-border` surface draws the dividers, so the
 * separators follow the grid however it reflows across breakpoints.
 */
export default function MetricGroup({ title, metrics }: MetricGroupProps) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-border bg-border">
      <header className="bg-background-secondary px-4 py-3.5 md:px-5">
        <h2 className="text-sm font-semibold text-foreground md:text-base">{title}</h2>
      </header>
      <div
        className={cn(
          'grid gap-px',
          metrics.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {metrics.map(({ label, value, icon: Icon, iconSurface, tone, ...trend }) => (
          <div key={label} className="flex flex-col gap-4 bg-background p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full text-white md:size-10',
                  iconSurface,
                )}
              >
                <Icon className="size-[18px] md:size-5" aria-hidden="true" />
              </span>
              <TrendChip {...trend} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium text-text-secondary md:text-sm">{label}</p>
              <p
                className={cn(
                  'text-2xl font-bold md:text-[28px]',
                  tone === 'critical' ? 'text-error' : 'text-foreground',
                )}
              >
                {value}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
