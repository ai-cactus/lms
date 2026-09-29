'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import DatePicker from '@/components/ui/DatePicker';
import { assignRetake } from '@/app/actions/course';
import { defaultRetakeDueDate } from '@/lib/course/retake-deadline';

interface AssignRetakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  enrollmentId: string;
  courseName: string;
  userName: string;
}

/**
 * Mounted on demand by its callers (one mount per opened row), so the due date
 * is pre-filled fresh for each retake rather than carried over from the last.
 */
export default function AssignRetakeModal({
  isOpen,
  onClose,
  enrollmentId,
  courseName,
  userName,
}: AssignRetakeModalProps) {
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState(() => defaultRetakeDueDate(new Date()));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await assignRetake(enrollmentId, reason, dueDate);
      if (result.success) {
        router.refresh(); // Refresh the page to show the new retake assignment
        onClose();
      } else {
        setError(result.refusedReason ?? 'Failed to assign retake. Please try again.');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An error occurred while assigning the retake.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Assign Retake</DialogTitle>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-text-secondary">
          This action will create a new retake attempt for <strong>{userName}</strong> on the course{' '}
          <strong>{courseName}</strong>. Their previous attempts will be preserved in the system but
          the course will be marked as in-progress again.
        </p>

        {error && <Alert variant="error">{error}</Alert>}

        <div>
          <span className="mb-2 block text-sm font-medium text-text-secondary">Due date</span>
          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            placeholder="Select retake due date"
            label="Retake due date"
            placement="top-end"
          />
          <p className="mt-1.5 text-xs text-text-tertiary">
            The learner gets the usual deadline reminders, and managers are alerted if it passes.
          </p>
        </div>

        <div>
          <label
            htmlFor="retake-reason"
            className="mb-2 block text-sm font-medium text-text-secondary"
          >
            Reason for retake (optional)
          </label>
          <textarea
            id="retake-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Granted a second chance after brief review session"
            className="min-h-20 w-full resize-y rounded-lg border border-border p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isSubmitting}>
            Assign Retake
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
