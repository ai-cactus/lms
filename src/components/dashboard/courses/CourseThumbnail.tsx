import React from 'react';
import Image from 'next/image';
import { NotebookText, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * `row` is the Courses page's name cell (design 15964:49039); `compact` fits the
 * 40x40 square slot the dashboard, staff-profile and audit tables reserve.
 */
export type CourseThumbnailSize = 'row' | 'compact';

interface CourseThumbnailProps {
  type: string | null | undefined;
  thumbnail: string | null | undefined;
  size?: CourseThumbnailSize;
  className?: string;
}

/**
 * Design component "Reading course thumbnail" (15964:48739). It is drawn for
 * every reading course, so a reading course's own artwork is not shown.
 */
function ReadingThumbnail({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-[#1c213d] bg-linear-to-b from-white/20 to-transparent',
        className,
      )}
    >
      <NotebookText className="size-[21px] text-[#f9fafb]" />
    </div>
  );
}

const VIDEO_FRAME_CLASS: Record<CourseThumbnailSize, string> = {
  // Design 15522:271922 — a 78x47 rectangular frame, narrower on small screens
  // so the row stays compact.
  row: 'h-[34px] w-[56px] sm:h-[47px] sm:w-[78px]',
  compact: 'size-10 rounded-[8px]',
};

const PLAY_BUTTON_CLASS: Record<CourseThumbnailSize, string> = {
  row: 'size-[11px] sm:size-[13px]',
  compact: 'size-[13px]',
};

const PLAY_ICON_CLASS: Record<CourseThumbnailSize, string> = {
  row: 'size-[5px] sm:size-[6px]',
  compact: 'size-[6px]',
};

function VideoThumbnail({
  thumbnail,
  size,
  className,
}: {
  thumbnail: string | null | undefined;
  size: CourseThumbnailSize;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative shrink-0 overflow-hidden bg-[#f1f5f9]',
        VIDEO_FRAME_CLASS[size],
        className,
      )}
    >
      {thumbnail ? (
        <>
          {/* The image fills the frame (Figma scaleMode=FILL). */}
          <Image
            src={thumbnail}
            alt=""
            fill
            sizes={size === 'row' ? '78px' : '40px'}
            // The thumbnail route is access-checked and versioned with `?v=`.
            // The optimizer fetches server-side without the viewer's cookies
            // (so it would get a 401), and refuses a local src with a query
            // string unless `images.localPatterns` allows it. The route already
            // serves a ~640px JPEG, so there is nothing to gain from it anyway.
            unoptimized={thumbnail.startsWith('/api/')}
            className="object-cover"
          />
          {/* The wash belongs to the artwork. Over the placeholder mark it would
              tint an icon the design never drew. */}
          <span className="absolute inset-0 bg-[#2c8f88]/40" />
        </>
      ) : (
        // No artwork: centre the placeholder mark rather than stretching it to
        // the frame's aspect ratio.
        <span className="flex size-full items-center justify-center">
          <Image src="/images/icon-course-blue.svg" alt="" width={24} height={24} />
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn(
            'flex items-center justify-center rounded-full border-[0.5px] border-white/40 bg-white/20 shadow-[0px_1px_6px_0px_rgba(13,13,18,0.25)] backdrop-blur-[5px]',
            PLAY_BUTTON_CLASS[size],
          )}
        >
          <Play className={cn('fill-white text-white', PLAY_ICON_CLASS[size])} strokeWidth={0} />
        </span>
      </span>
    </div>
  );
}

/**
 * Decorative course artwork for table rows. The title beside it already names
 * the course, so it is hidden from assistive technology.
 */
export default function CourseThumbnail({
  type,
  thumbnail,
  size = 'row',
  className,
}: CourseThumbnailProps) {
  if (type === 'video') {
    return <VideoThumbnail thumbnail={thumbnail} size={size} className={className} />;
  }
  return <ReadingThumbnail className={className} />;
}
