'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteDocument } from '@/app/actions/documents';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DocumentDeleteButtonProps {
  documentId: string;
  filename: string;
  /** Deleting a course-backed document severs the course's source link — warn, don't block. */
  hasLinkedCourse: boolean;
}

export default function DocumentDeleteButton({
  documentId,
  filename,
  hasLinkedCourse,
}: DocumentDeleteButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    setConfirmOpen(false);
    setError(null);

    startTransition(async () => {
      const result = await deleteDocument(documentId);
      if (result.success) {
        // The document this page renders is gone — leave before it 404s.
        router.push('/dashboard/documents');
        router.refresh();
      } else {
        setError(result.error ?? 'Failed to delete document.');
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        className="border-error/30 text-error hover:bg-error/10 hover:text-error"
        loading={isPending}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Delete
      </Button>

      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{filename}&rdquo; will be removed from the Documents hub. Nothing is erased:
              the file, every version and its PHI reports are retained for compliance. It cannot be
              restored from the app.
              {hasLinkedCourse &&
                ' This document is the source for a generated course — that course is unaffected, but it will no longer be able to open this document.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
