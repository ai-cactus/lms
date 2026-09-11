'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface CourseSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  courseTitle?: string;
}

export default function CourseSuccessModal({
  isOpen,
  onClose,
  courseId,
  courseTitle,
}: CourseSuccessModalProps) {
  const router = useRouter();

  const handleFinish = () => {
    onClose();
    router.push('/dashboard/training');
  };

  const handleAssign = () => {
    onClose();
    router.push(`/dashboard/training/courses/${courseId}/assign`);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gap-0 rounded-lg px-8 py-10 text-center sm:max-w-[420px]"
      >
        <DialogTitle className="sr-only">Course published</DialogTitle>

        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-success ring-8 ring-success/15">
          <Check className="size-8 text-primary-foreground" strokeWidth={3} aria-hidden="true" />
        </div>

        <h2 className="mb-2 text-2xl font-bold leading-tight tracking-[-0.02em] text-foreground">
          Course Published
        </h2>

        {courseTitle && (
          <p className="mb-2 flex items-center justify-center gap-2 text-base font-semibold text-foreground">
            <FileText className="size-4 text-primary" aria-hidden="true" />
            {courseTitle}
          </p>
        )}

        <p className="mb-8 text-[15px] leading-[1.5] text-text-secondary">
          You have successfully created a new course. You can assign it to your team now, or manage
          it later from the training dashboard.
        </p>

        <div className="flex flex-col gap-3">
          <Button
            variant="default"
            className="h-[52px] w-full rounded-[10px] text-base font-semibold"
            onClick={handleAssign}
          >
            Assign to Workers
          </Button>
          <Button
            variant="outline"
            className="h-[52px] w-full rounded-[10px] border border-border text-base font-semibold text-foreground"
            onClick={handleFinish}
          >
            Go to Dashboard
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
