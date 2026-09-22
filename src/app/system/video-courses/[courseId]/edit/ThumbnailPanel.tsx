'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ImageIcon, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  regenerateVideoCourseThumbnail,
  removeCustomVideoCourseThumbnail,
} from '@/app/actions/video-course';
import type { CourseThumbnailSource } from '@/lib/video/thumbnail';
import { ALLOWED_THUMBNAIL_TYPES } from '@/lib/video/upload-config';
import { logger } from '@/lib/logger';

const SOURCE_LABEL: Record<CourseThumbnailSource, string> = {
  custom: 'Custom upload',
  preview: 'Generated from preview video',
  lesson: 'Generated from lesson video',
  none: 'None — placeholder shown',
};

type PendingAction = 'upload' | 'regenerate' | 'remove';

export interface ThumbnailPanelProps {
  courseId: string;
  source: CourseThumbnailSource;
  /** Versioned system thumbnail route URL; null when `source` is `none`. */
  imageUrl: string | null;
  /** Why "Regenerate from video" is unavailable, or null when it is available. */
  regenerateBlockedReason: string | null;
  maxUploadBytes: number;
}

async function readUploadError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    /* not JSON — fall through to the generic message */
  }
  return 'Upload failed. Please try again.';
}

export default function ThumbnailPanel({
  courseId,
  source,
  imageUrl,
  regenerateBlockedReason,
  maxUploadBytes,
}: ThumbnailPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = pending !== null;
  const maxUploadMb = Math.round(maxUploadBytes / 1048576);

  const handleFile = async (file: File) => {
    setError(null);
    if (!(ALLOWED_THUMBNAIL_TYPES as readonly string[]).includes(file.type)) {
      setError('Image must be JPEG, PNG or WebP.');
      return;
    }
    if (file.size > maxUploadBytes) {
      setError(`Image exceeds ${maxUploadMb} MB.`);
      return;
    }

    setPending('upload');
    try {
      const body = new FormData();
      body.append('image', file);
      const res = await fetch(`/api/system/video-courses/${courseId}/thumbnail`, {
        method: 'POST',
        body,
      });
      if (!res.ok) {
        setError(await readUploadError(res));
        return;
      }
      router.refresh();
    } catch (err) {
      logger.error({ msg: '[ThumbnailPanel] upload failed', err, courseId });
      setError('Upload failed. Please check your connection and try again.');
    } finally {
      setPending(null);
    }
  };

  const runAction = async (
    action: Exclude<PendingAction, 'upload'>,
    call: (id: string) => Promise<{ success: true } | { success: false; error: string }>,
  ) => {
    setError(null);
    setPending(action);
    try {
      const result = await call(courseId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      logger.error({ msg: '[ThumbnailPanel] action failed', err, courseId, action });
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <section
      aria-labelledby="thumbnail-heading"
      className="flex flex-col gap-4 rounded-[10px] border border-border p-4 sm:p-5"
    >
      <div>
        <h2 id="thumbnail-heading" className="text-base font-semibold text-foreground">
          Thumbnail
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Shown beside this course in every course list.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-[8px] bg-background-secondary sm:w-60">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt="Current course thumbnail"
              fill
              sizes="(min-width: 640px) 240px, 100vw"
              // Access-checked route: the optimizer would fetch it without the
              // admin's cookie. See CourseThumbnail.
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <ImageIcon className="size-8 text-text-tertiary" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-sm text-foreground">
            <span className="text-text-secondary">Source: </span>
            <span className="font-medium" data-testid="thumbnail-source">
              {SOURCE_LABEL[source]}
            </span>
          </p>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_THUMBNAIL_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={pending === 'upload'}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {pending !== 'upload' && <Upload aria-hidden="true" />}
              Upload image
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={pending === 'regenerate'}
              disabled={busy || regenerateBlockedReason !== null}
              aria-describedby={regenerateBlockedReason ? 'thumbnail-regenerate-hint' : undefined}
              onClick={() => void runAction('regenerate', regenerateVideoCourseThumbnail)}
            >
              {pending !== 'regenerate' && <RefreshCw aria-hidden="true" />}
              Regenerate from video
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={pending === 'remove'}
              disabled={busy || source !== 'custom'}
              onClick={() => void runAction('remove', removeCustomVideoCourseThumbnail)}
            >
              {pending !== 'remove' && <Trash2 aria-hidden="true" />}
              Remove custom
            </Button>
          </div>

          <p className="text-xs text-text-muted">
            JPEG, PNG or WebP, up to {maxUploadMb} MB. Images are resized to 640 px wide.
          </p>
          {regenerateBlockedReason && (
            <p id="thumbnail-regenerate-hint" className="text-xs text-text-muted">
              {regenerateBlockedReason}
            </p>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Thumbnail not updated">
          {error}
        </Alert>
      )}
    </section>
  );
}
