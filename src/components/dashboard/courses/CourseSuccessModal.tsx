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
        className="gap-0 rounded-[16px] px-8 py-10 text-center sm:max-w-[480px]"
      >
        <DialogTitle className="sr-only">Course published</DialogTitle>

        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-[#16a34a] ring-8 ring-[#dcfce7]">
          <Check className="size-8 text-white" strokeWidth={3} aria-hidden="true" />
        </div>

        <h2 className="mb-2 text-2xl font-bold leading-tight tracking-[-0.02em] text-[#0d0d12]">
          Course Published
        </h2>

        {courseTitle && (
          <p className="mb-2 flex items-center justify-center gap-2 text-base font-semibold text-foreground">
            <FileText className="size-4 text-[#0ea5e9]" aria-hidden="true" />
            {courseTitle}
          </p>
        )}

        <p className="mb-8 text-[15px] leading-[1.5] text-[#666d80]">
          You have successfully created a new course. You can assign it to your team now, or manage
          it later from the training dashboard.
        </p>

        <div className="flex flex-col gap-3">
          <Button
            variant="default"
            className="h-[52px] w-full rounded-[12px] text-base font-semibold"
            onClick={handleAssign}
          >
            Assign to Workers
          </Button>
          <Button
            variant="outline"
            className="h-[52px] w-full rounded-[12px] border-[1.5px] border-[#e5e7ea] text-base font-semibold text-[#454353]"
            onClick={handleFinish}
          >
            Go to Dashboard
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
