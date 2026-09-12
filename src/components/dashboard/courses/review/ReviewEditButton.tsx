'use client';

import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The design's "Edit ✎" affordance on the step-5 review rail. The wizard review
 * is read-only — lesson content is edited after publishing, from the course
 * detail screen — so the button is rendered but inert until that path exists.
 */
export default function ReviewEditButton({ className }: { className?: string }) {
  return (
    <Button
      variant="outline"
      disabled
      title="Lesson content can be edited after the course is published"
      className={`h-12 w-full rounded-[10px] border border-border text-[15px] font-semibold text-primary ${className ?? ''}`}
    >
      Edit
      <Pencil className="size-4" aria-hidden="true" />
    </Button>
  );
}
