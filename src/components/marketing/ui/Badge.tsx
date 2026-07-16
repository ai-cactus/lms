import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeProps = {
  children: ReactNode;
  className?: string;
};

/** Small solid brand pill, e.g. the "New" tag. */
export function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-brand px-2 py-0.5 text-[12px] font-medium leading-tight text-white',
        className,
      )}
    >
      {children}
    </span>
  );
}
