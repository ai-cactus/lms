'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Star, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface BadgeSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseName: string;
  organizationName: string;
  badgeId?: string;
  issuedDate: string;
  courseId?: string; // Optional for navigation
}

export default function BadgeSuccessModal({
  isOpen,
  onClose,
  courseName,
  organizationName,
  badgeId = 'LMS-104',
  issuedDate,
  courseId,
}: BadgeSuccessModalProps) {
  const router = useRouter();

  const handleDashboard = () => {
    if (courseId) {
      router.push(`/worker/courses/${courseId}`);
    } else {
      router.push('/worker');
    }
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
        className="max-w-[90vw] gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <div className="flex min-h-[480px] w-full flex-col-reverse overflow-hidden bg-background md:flex-row">
          <div className="flex flex-1 flex-col items-center p-6 text-center sm:p-10">
            <div className="relative mb-6">
              <Star
                className="size-16 fill-[#F6E05E] text-[#D69E2E]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <div className="absolute -bottom-3 left-1/2 h-5 w-6 -translate-x-1/2 bg-[#D69E2E] [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]" />
            </div>

            <h2 className="mb-3 text-xl font-bold leading-tight text-foreground sm:text-2xl">
              {`Well done! You've earned a Certificate!`}
            </h2>

            <p className="mb-6 max-w-full text-sm leading-relaxed text-text-secondary sm:mb-8 sm:max-w-[80%]">
              The certificate is now securely stored and accessible on your dashboard anytime.
            </p>

            <div className="mb-6 w-full rounded-md border border-border bg-background p-4 text-left sm:mb-8">
              <div className="mb-2 flex items-start justify-between">
                <h3 className="text-base font-semibold text-text-secondary">{courseName}</h3>
                <CheckCircle2
                  className="size-5 shrink-0 text-[#1DA1F2]"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </div>
              <div className="text-xs leading-relaxed text-text-tertiary">
                <div>{organizationName}</div>
                <div>Issued on: {issuedDate}</div>
                <div>Certificate ID: {badgeId}</div>
              </div>
            </div>

            <Button variant="outline" className="mb-4 w-full" onClick={handleDashboard}>
              Go to Dashboard
            </Button>

            <div className="text-sm text-text-tertiary">
              or{' '}
              <span
                className="cursor-pointer font-medium text-primary underline hover:opacity-80 focus-visible:rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onClick={() => router.push('/worker')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && router.push('/worker')}
              >
                start a new course here
              </span>
            </div>
          </div>

          <div className="relative flex min-h-[180px] w-full items-center justify-center overflow-hidden md:w-[300px]">
            <Image
              src="/images/course_badge_modal.png"
              alt="Badge Success"
              fill
              className="object-cover object-center"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
