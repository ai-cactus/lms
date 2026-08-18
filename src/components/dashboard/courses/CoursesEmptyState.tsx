'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CoursesEmptyStateVariant = 'video' | 'reading';

interface CoursesEmptyStateProps {
  variant: CoursesEmptyStateVariant;
  canCreateCourse: boolean;
  onCreate: () => void;
  /** Switches to the other course-type tab, which is where the copy points the user. */
  onSwitchTab: () => void;
}

const COPY: Record<CoursesEmptyStateVariant, { title: string; body: string; switchLabel: string }> =
  {
    video: {
      title: 'No video courses yet.',
      body: 'Browse the reading courses generated from your policy documents, or create your first course to get started.',
      switchLabel: 'View reading courses',
    },
    reading: {
      title: 'No reading courses yet.',
      body: 'Upload a policy or compliance document to generate your first training course automatically, or explore our video courses to get started.',
      switchLabel: 'View video courses',
    },
  };

const BUTTON_CLASS = 'h-12 rounded-[12px] px-6 text-[15.5px] font-semibold tracking-[-0.31px]';

export default function CoursesEmptyState({
  variant,
  canCreateCourse,
  onCreate,
  onSwitchTab,
}: CoursesEmptyStateProps) {
  const { title, body, switchLabel } = COPY[variant];

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-4 py-10 md:min-h-[520px]">
      <div className="flex w-full max-w-[482px] flex-col items-center gap-5">
        <Image
          src="/images/courses-empty-state-document.svg"
          alt=""
          width={154}
          height={154}
          aria-hidden="true"
          className="size-[120px] md:size-[154px]"
        />
        <div className="flex flex-col gap-[5px] text-center">
          <p className="text-[20px] leading-[1.32] font-semibold text-[#11181c] md:text-[24.5px]">
            {title}
          </p>
          <p className="text-[15px] leading-[1.45] text-[#475367] md:text-[16px]">{body}</p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Button
            variant="outline"
            size="lg"
            onClick={onSwitchTab}
            className={cn(BUTTON_CLASS, 'border-[#d4d4d4] text-primary hover:text-primary')}
          >
            {switchLabel}
          </Button>
          {canCreateCourse && (
            <Button size="lg" onClick={onCreate} className={BUTTON_CLASS}>
              Create your first course
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
