import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/marketing/ui/Badge';
import { ArrowRight } from '@/components/marketing/ui/icons';
import { cn } from '@/lib/utils';

type AnnouncementBannerProps = {
  badge: ReactNode;
  children: ReactNode;
  href?: string;
  className?: string;
};

const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/** The "New · Theraptly LMS →" pill that sits above the hero headline. */
export function AnnouncementBanner({
  badge,
  children,
  href = '#',
  className,
}: AnnouncementBannerProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex items-center gap-2 rounded-full border border-[#efeeed] bg-[#fafaf9] py-[5px] pl-[6px] pr-[8px] transition-colors hover:bg-white',
        focusRing,
        className,
      )}
    >
      <Badge>{badge}</Badge>
      <span className="text-[14px] font-medium leading-tight text-[#57534d]">{children}</span>
      <ArrowRight className="size-[14px] text-[#57534d] transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
