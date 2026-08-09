'use client';

import React, { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { updateCourse } from '@/app/actions/course';

export default function CourseRenameModal({
  courseId,
  currentTitle,
  onClose,
  onRenamed,
}: {
  courseId: string;
  currentTitle: string;
  onClose: () => void;
  onRenamed: (newTitle: string) => void;
}) {
  const [title, setTitle] = useState(currentTitle);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Course title cannot be empty.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateCourse(courseId, { title: trimmed });
        onRenamed(trimmed);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename course.');
      }
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Course</DialogTitle>
          <DialogDescription>Enter a new title for &ldquo;{currentTitle}&rdquo;.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Input
              className="h-11"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              disabled={isPending}
              aria-label="New course title"
            />
            {error && <Alert variant="error">{error}</Alert>}
          </div>

          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
