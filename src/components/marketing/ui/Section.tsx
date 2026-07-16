import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type SectionProps = {
  children: ReactNode;
  /** Outer element — defaults to <section>. */
  as?: ElementType;
  /** Classes for the full-bleed outer wrapper (backgrounds, vertical padding). */
  className?: string;
  /** Classes for the inner max-width container. */
  innerClassName?: string;
  id?: string;
};

/**
 * Shared page section: a full-bleed outer wrapper plus a centered, max-width
 * inner container with the same responsive gutter the navbar uses. Reused by
 * every landing-page section so horizontal rhythm stays consistent.
 */
export function Section({
  children,
  as: Tag = 'section',
  className,
  innerClassName,
  id,
}: SectionProps) {
  return (
    <Tag id={id} className={cn('w-full', className)}>
      <div
        className={cn(
          'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-12 xl:px-[110px]',
          innerClassName,
        )}
      >
        {children}
      </div>
    </Tag>
  );
}
