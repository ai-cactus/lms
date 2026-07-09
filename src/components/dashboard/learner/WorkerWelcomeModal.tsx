'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useModalContext } from '@/components/ui/legacy/ModalContext';
import { logger } from '@/lib/logger';

const SNOOZE_DURATION_MS = 12 * 60 * 60 * 1000;

interface WorkerWelcomeModalProps {
  courseCount: number;
  firstCourseId?: string;
  hasProgress?: boolean; // New prop to check if user already started something
}

export default function WorkerWelcomeModal({
  courseCount,
  firstCourseId,
  hasProgress,
}: WorkerWelcomeModalProps) {
  const {
    registerModal,
    unregisterModal,
    requestOpen,
    isModalOpen,
    dismissModal,
    shouldShowModal,
  } = useModalContext();
  const modalId = 'workerWelcome';

  const [hasMounted, setHasMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration guard
    setHasMounted(true);
    registerModal(modalId, 5);
    return () => unregisterModal(modalId);
  }, [registerModal, unregisterModal, modalId]);

  // Effect 2: Request open after registration has been committed.
  useEffect(() => {
    if (!hasMounted) return;

    logger.info({
      msg: '[WorkerWelcomeModal] Checking whether to open.',
      data: { courseCount, hasProgress },
    });

    if (courseCount > 0 && !hasProgress && shouldShowModal(modalId)) {
      logger.info({ msg: '[WorkerWelcomeModal] Requesting Open' });
      requestOpen(modalId);
    }
  }, [hasMounted, courseCount, hasProgress, shouldShowModal, requestOpen, modalId]);

  const handleClose = () => {
    dismissModal(modalId, SNOOZE_DURATION_MS);
  };

  const handleStart = () => {
    dismissModal(modalId, -1);
    if (firstCourseId) {
      router.push(`/learn/${firstCourseId}`);
    }
  };

  const isOpen = isModalOpen(modalId);

  if (!hasMounted || !isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-[900px]">
        <div className="flex max-h-[85vh] w-full flex-col overflow-y-auto md:max-h-none md:min-h-[500px] md:flex-row md:overflow-y-visible">
          <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[#e6fffa] px-6 py-8 text-center md:p-10">
            <div className="absolute -left-[50px] -top-[50px] z-0 size-[200px] rounded-full bg-[#38b2ac] opacity-10 md:size-[300px]" />
            <div className="relative z-[1] mb-5 h-auto w-[180px] md:mb-[30px] md:w-[280px]">
              <Image
                src="/images/onboarding-welcome.png"
                alt="Welcome"
                width={280}
                height={280}
                className="object-contain"
                priority
              />
            </div>

            <DialogTitle className="z-[1] mb-3 font-heading text-[22px] font-extrabold leading-tight text-[#065f46] md:mb-4 md:text-[28px]">
              Your first training
              <br />
              course awaits you
            </DialogTitle>

            <DialogDescription className="z-[1] mb-5 max-w-[320px] text-sm leading-normal text-[#2c7a7b] md:mb-8 md:text-base">
              Join professionals learning with Theraply in a clear, accessible, and supportive way.
            </DialogDescription>

            <Button
              size="lg"
              onClick={handleStart}
              className="z-[1] mt-6 w-full max-w-[240px] rounded-full"
            >
              Start your first course
            </Button>
          </div>

          <div className="relative flex flex-1 flex-col justify-center px-6 py-8 md:px-10 md:py-12">
            <h3 className="mb-6 font-heading text-xl font-bold text-[#1a202c] md:mb-10 md:text-2xl">
              How to get started
            </h3>

            <div className="flex flex-col gap-5 md:gap-8">
              <div className="flex items-start gap-4">
                <div className="text-lg font-extrabold leading-tight text-[#1a202c]">1.</div>
                <div className="flex-1">
                  <div className="mb-1.5 text-[15px] font-bold text-[#1a202c] md:text-base">
                    Log In to Your Dashboard
                  </div>
                  <div className="text-[13px] leading-normal text-[#718096] md:text-sm">
                    Access your assigned courses in one place, right from your computer or phone.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-lg font-extrabold leading-tight text-[#1a202c]">2.</div>
                <div className="flex-1">
                  <div className="mb-1.5 text-[15px] font-bold text-[#1a202c] md:text-base">
                    Complete your Courses and take quizzes.
                  </div>
                  <div className="text-[13px] leading-normal text-[#718096] md:text-sm">
                    Training includes courses and quizzes. Access your assigned courses in one
                    place, right from your computer or phone.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-lg font-extrabold leading-tight text-[#1a202c]">3.</div>
                <div className="flex-1">
                  <div className="mb-1.5 text-[15px] font-bold text-[#1a202c] md:text-base">
                    Earn Your Certificate
                  </div>
                  <div className="text-[13px] leading-normal text-[#718096] md:text-sm">
                    Pass your training and instantly get a certificate you can use to prove
                    compliance.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
