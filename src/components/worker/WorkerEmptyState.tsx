'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import { useModalContext } from '@/components/ui/legacy/ModalContext';
import { Button } from '@/components/ui/button';

export default function WorkerEmptyState() {
  const {
    registerModal,
    unregisterModal,
    requestOpen,
    isModalOpen,
    dismissModal,
    shouldShowModal,
  } = useModalContext();
  const modalId = 'workerEmptyState';
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration guard
    setHasMounted(true);
    // Priority 1
    registerModal(modalId, 1);

    if (shouldShowModal(modalId)) {
      requestOpen(modalId);
    }

    return () => unregisterModal(modalId);
  }, [registerModal, unregisterModal, requestOpen, shouldShowModal, modalId]);

  const handleClose = () => {
    // Snooze for 7 days
    dismissModal(modalId, 7 * 24 * 60 * 60 * 1000);
  };

  const isOpen = isModalOpen(modalId);

  if (!hasMounted || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-5">
      <div className="relative mx-auto flex max-h-[calc(100vh-40px)] w-full max-w-[1000px] overflow-y-auto rounded-[20px] border border-[#e2e8f0] bg-white p-4 shadow-md max-[900px]:flex-col">
        {/* Close Button */}
        <div className="absolute right-4 top-4 z-10">
          <button
            className="flex size-8 items-center justify-center rounded-full border border-[#e2e8f0] bg-white text-[#4a5568] shadow-sm transition-all hover:scale-105 hover:bg-[#f7fafc] hover:text-[#2d3748]"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Left Panel */}
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-[20px] bg-[#d3f5ee] p-10 text-center max-[900px]:mb-6 max-[900px]:mt-10 max-[900px]:rounded-2xl max-[900px]:p-[30px] max-md:mb-4 max-md:p-6">
          <div className="absolute -left-[50px] -top-[50px] z-0 size-[300px] rounded-full bg-[#38b2ac] opacity-10" />
          <div className="relative z-[1] mb-[30px] h-auto w-[280px] max-md:w-[200px]">
            <Image
              src="/images/worker-empty-illustration-v2.png"
              alt="Welcome"
              width={280}
              height={280}
              className="object-contain"
              priority
            />
          </div>

          <h2 className="z-[1] mb-3.5 text-[39px] font-bold leading-[1.15] text-[#007d45] max-md:text-[28px]">
            Your first training
            <br />
            course awaits you
          </h2>

          <p className="z-[1] mb-8 max-w-[360px] text-[17px] font-medium leading-normal text-black/70">
            Join professionals learning with Theraptly in a clear, accessible, and supportive way.
          </p>

          <Button
            size="lg"
            className="z-[1] mt-6 w-full max-w-[240px] rounded-full"
            onClick={() => {
              handleClose(); // Close modal on start
              // Ideally we focus somewhere relevant or navigate
            }}
          >
            Start your first course
          </Button>
        </div>

        {/* Right Panel */}
        <div className="relative flex flex-1 flex-col justify-center px-[50px] py-[60px] max-[900px]:p-4 max-md:p-4">
          <h3 className="mb-10 text-[30px] font-bold tracking-[-0.6px] text-black max-md:text-[22px]">
            How to get started
          </h3>

          <div className="flex flex-col gap-8">
            <div className="flex items-start gap-4">
              <div className="text-lg font-extrabold leading-tight text-[#1a202c]">1.</div>
              <div className="flex-1">
                <div className="mb-1.5 text-base font-bold text-[#1a202c]">
                  Log In to Your Dashboard
                </div>
                <div className="text-sm leading-relaxed text-[#718096]">
                  Access your assigned courses in one place, right from your computer or phone.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="text-lg font-extrabold leading-tight text-[#1a202c]">2.</div>
              <div className="flex-1">
                <div className="mb-1.5 text-base font-bold text-[#1a202c]">
                  Complete your Courses and take quizzes.
                </div>
                <div className="text-sm leading-relaxed text-[#718096]">
                  Training includes courses and quizzes. Access your assigned courses in one place,
                  right from your computer or phone.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="text-lg font-extrabold leading-tight text-[#1a202c]">3.</div>
              <div className="flex-1">
                <div className="mb-1.5 text-base font-bold text-[#1a202c]">
                  Earn Your Certificate
                </div>
                <div className="text-sm leading-relaxed text-[#718096]">
                  Pass your training and instantly get a certificate you can use to prove
                  compliance.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
