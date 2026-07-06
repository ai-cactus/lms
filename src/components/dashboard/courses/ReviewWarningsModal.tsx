'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface ReviewWarningsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPublishAnyway: () => void;
  onSaveDraft: () => void;
  courseTitle: string;
  warnings: string[];
  isPublishing: boolean;
}

/**
 * Publish-review gate (F-051). Shown when a freshly generated course was saved
 * as a draft because the server flagged quality warnings. The admin must
 * explicitly acknowledge the warnings before publishing anyway, or leave the
 * course as a draft for later review.
 */
export default function ReviewWarningsModal({
  isOpen,
  onClose,
  onPublishAnyway,
  onSaveDraft,
  courseTitle,
  warnings,
  isPublishing,
}: ReviewWarningsModalProps) {
  const [isAcknowledged, setIsAcknowledged] = useState(false);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPublishing) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-warning/10">
            <AlertTriangle className="size-6 text-warning" aria-hidden="true" />
          </div>
          <DialogTitle>Review before publishing</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-text-secondary">
            <strong className="font-semibold text-foreground">
              &quot;{courseTitle || 'This course'}&quot;
            </strong>{' '}
            was saved as a draft because the automated checks found the following quality issues:
          </p>

          <ul className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4">
            {warnings.map((warning, index) => (
              <li key={index} className="flex items-start gap-2.5 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>

          <label htmlFor="acknowledge-warnings" className="flex cursor-pointer items-start gap-2.5">
            <Checkbox
              id="acknowledge-warnings"
              className="mt-0.5 shrink-0"
              checked={isAcknowledged}
              onCheckedChange={(c) => setIsAcknowledged(c === true)}
              disabled={isPublishing}
            />
            <span className="text-sm leading-snug text-foreground">
              I have reviewed these warnings and want to publish this course anyway.
            </span>
          </label>
        </div>

        <DialogFooter className="gap-3 sm:justify-end">
          <Button variant="outline" onClick={onSaveDraft} disabled={isPublishing}>
            Keep as Draft
          </Button>
          <Button
            variant="default"
            onClick={onPublishAnyway}
            disabled={!isAcknowledged || isPublishing}
            loading={isPublishing}
          >
            Publish Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
