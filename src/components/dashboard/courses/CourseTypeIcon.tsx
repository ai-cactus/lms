import React from 'react';
import { SquarePlay, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Renders the course "Type" indicator used in the course tables — a play icon
 * for video courses and a document icon for text courses.
 */
export default function CourseTypeIcon({
  type,
  className,
}: {
  type?: string | null;
  className?: string;
}) {
  const isVideo = type === 'video';
  const Icon = isVideo ? SquarePlay : FileText;
  return (
    <Icon
      className={cn('size-5 text-[#475569]', className)}
      aria-label={isVideo ? 'Video course' : 'Text course'}
    />
  );
}
