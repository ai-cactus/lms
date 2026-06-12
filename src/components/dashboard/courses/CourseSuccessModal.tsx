'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { FileText } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ShareCourseModal from '../training/ShareCourseModal';

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
  const [showShareModal, setShowShareModal] = React.useState(false);

  const handleFinish = () => {
    onClose();
    router.push('/dashboard/training');
  };

  if (showShareModal) {
    return <ShareCourseModal isOpen={true} onClose={handleFinish} courseId={courseId} />;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="relative overflow-hidden px-4 pt-2 pb-6 text-center sm:max-w-md"
      >
        {/* Ambient background glow */}
        <div className="pointer-events-none absolute top-0 left-1/2 z-0 h-[300px] w-[300px] -translate-x-1/2 animate-[pulse_4s_ease-in-out_infinite] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.15)_0%,rgba(16,185,129,0)_70%)]"></div>

        {/* 3D Illustration */}
        <div className="relative z-10 mx-auto mt-[-20px] mb-5 h-[180px] w-[180px]">
          <Image
            src="/images/course-success.png"
            alt="Success Checkmark"
            width={200}
            height={200}
            className="h-full w-full object-contain drop-shadow-[0_15px_25px_rgba(0,0,0,0.1)]"
            priority
          />
        </div>

        <h2 className="relative z-10 mb-3 text-[26px] leading-tight font-extrabold tracking-tight text-foreground">
          Course{' '}
          <span className="bg-gradient-to-br from-[#059669] to-[#10b981] bg-clip-text text-transparent">
            Published!
          </span>
        </h2>

        {courseTitle && (
          <div className="relative z-10 mb-6 rounded-xl border border-border bg-background-secondary px-5 py-4 shadow-sm">
            <div className="mb-1.5 text-[13px] font-semibold tracking-wider text-text-secondary uppercase">
              Course Title
            </div>
            <div className="flex items-center justify-center gap-2 text-lg font-bold text-foreground">
              {/* Small document icon next to title */}
              <FileText className="size-5 text-[#0ea5e9]" aria-hidden="true" />
              {courseTitle}
            </div>
          </div>
        )}

        <p className="relative z-10 mb-8 px-4 text-base leading-relaxed text-text-secondary">
          You have successfully created a new course. You can assign it to your team now, or manage
          it later from the training dashboard.
        </p>

        <div className="relative z-10 flex flex-col gap-3 px-4">
          <Button variant="default" className="w-full" onClick={() => setShowShareModal(true)}>
            Assign to Workers
          </Button>
          <Button variant="outline" className="w-full" onClick={handleFinish}>
            Go to Training Dashboard
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
