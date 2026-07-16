'use client';

import type { ReactNode } from 'react';
import { useInView } from '@/components/marketing/lib/useInView';
import { cn } from '@/lib/utils';

type RevealProps = {
  children: ReactNode;
  /** Stagger delay in ms (for grids/lists). */
  delay?: number;
  className?: string;
};

/**
 * Fades + rises its children in once they scroll into view (one-shot).
 * Renders a <div> — pass the container's own classes via `className` so it can
 * BE the element (no extra wrapper) for hover-free containers; for elements that
 * also have hover transforms (cards/pills), use Reveal as a wrapper instead so
 * the entrance delay never lags the hover.
 *
 * All motion is gated behind `motion-safe`: reduced-motion users see everything
 * fully visible and static (no opacity-0, no transform).
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        'motion-safe:transition-[opacity,transform] motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
        inView
          ? 'motion-safe:translate-y-0 motion-safe:opacity-100'
          : 'motion-safe:translate-y-4 motion-safe:opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
