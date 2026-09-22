import React from 'react';
import { CircleDashed, CircleSlash, Hourglass, UsersRound, type LucideIcon } from 'lucide-react';
import { courseListStatus, type CourseListStatusKey } from '@/lib/course/course-list-status';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<CourseListStatusKey, { className: string; Icon: LucideIcon }> = {
  assigned: { className: 'bg-[#d9fae9] text-[#308242]', Icon: UsersRound },
  published: { className: 'bg-[#dbeafe] text-[#2563eb]', Icon: Hourglass },
  draft: { className: 'bg-[#fffad1] text-[#dc6803]', Icon: CircleDashed },
  // Figma draws Inactive like a live state; product ruled it neutral grey so a
  // retired course never reads as available.
  inactive: { className: 'bg-[#f0f2f5] text-[#666d80]', Icon: CircleSlash },
};

/** Status pill for a course list row (design 15964:49039 / 15964:48711). */
export default function CourseListStatusBadge({
  status,
  enrollmentsCount,
  className,
}: {
  status: string | null | undefined;
  enrollmentsCount: number;
  className?: string;
}) {
  const { key, label } = courseListStatus(status, enrollmentsCount);
  const { className: toneClassName, Icon } = STATUS_STYLES[key];

  return (
    <span
      data-status={key}
      className={cn(
        'inline-flex w-fit items-center gap-[5px] rounded-full px-[11px] py-[3px] text-[14px] leading-5 font-medium tracking-normal whitespace-nowrap',
        toneClassName,
        className,
      )}
    >
      {key === 'assigned' ? (
        <Icon className="size-[14px] shrink-0 fill-current" aria-hidden="true" />
      ) : (
        <Icon className="size-[13px] shrink-0" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
