'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

import { useModalContext } from '@/components/ui/legacy/ModalContext';
import { Button } from '@/components/ui/button';

interface DashboardEmptyStateProps {
  totalCourses: number;
}

export default function DashboardEmptyState({ totalCourses }: DashboardEmptyStateProps) {
  const {
    registerModal,
    unregisterModal,
    requestOpen,
    isModalOpen,
    dismissModal,
    shouldShowModal,
  } = useModalContext();
  const modalId = 'dashboardEmptyState';
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration guard
    setHasMounted(true);
    // Priority 1 (Lowest)
    registerModal(modalId, 1);

    if (totalCourses === 0 && shouldShowModal(modalId)) {
      requestOpen(modalId);
    }

    return () => unregisterModal(modalId);
  }, [totalCourses, registerModal, unregisterModal, requestOpen, shouldShowModal, modalId]);

  const handleClose = () => {
    // Snooze for 7 days
    dismissModal(modalId, 7 * 24 * 60 * 60 * 1000);
  };

  const isOpen = isModalOpen(modalId);

  if (!hasMounted || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative mx-auto w-full max-w-[900px] overflow-y-auto rounded-2xl bg-white p-4 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_10px_10px_-5px_rgba(0,0,0,0.04)] max-h-[calc(100vh-48px)]">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-6 top-6 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full bg-[#f1f5f9] text-[#64748b] transition-all hover:bg-[#e2e8f0] hover:text-[#475569]"
          onClick={handleClose}
        >
          <X className="size-5" />
        </Button>

        <div className="flex min-h-[500px] flex-col md:flex-row">
          <div className="flex flex-1 flex-col items-center justify-center rounded-[20px] bg-[#d1fae5] p-8 text-center md:mt-0 md:p-10">
            {/* Decorative illustration — preserved as-is (art, not an icon) */}
            <div className="mb-8">
              <svg
                width="200"
                height="180"
                viewBox="0 0 200 180"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="40"
                  y="60"
                  width="120"
                  height="100"
                  rx="8"
                  fill="white"
                  stroke="#10B981"
                  strokeWidth="2"
                />
                <rect x="55" y="80" width="90" height="8" rx="4" fill="#D1FAE5" />
                <rect x="55" y="100" width="60" height="8" rx="4" fill="#D1FAE5" />
                <circle cx="100" cy="50" r="30" fill="#10B981" />
                <path
                  d="M90 50 L98 58 L114 42"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M20 140 L40 140" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
                <path d="M160 90 L180 90" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
                <path
                  d="M150 150 L170 150"
                  stroke="#10B981"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="60" cy="140" r="15" fill="#34D399" />
                <circle cx="140" cy="140" r="15" fill="#34D399" />
                <rect x="50" y="155" width="20" height="25" rx="5" fill="#34D399" />
                <rect x="130" y="155" width="20" height="25" rx="5" fill="#34D399" />
              </svg>
            </div>

            <h2 className="mb-3 text-2xl font-bold leading-[1.3] text-[#065f46]">
              Turn Your Healthcare Policies <br />
              into Interactive Training in <br />
              Minutes.
            </h2>
            <p className="max-w-full text-base leading-[1.5] text-[#374151]">
              Operationalize your policies and procedures <br />
              by training your staff
            </p>

            <Link
              href="/dashboard/courses/create"
              className="mt-8 inline-flex items-center rounded-full bg-[#059669] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#047857]"
              onClick={handleClose}
            >
              Create your first course
            </Link>
          </div>

          <div className="flex flex-[1.2] flex-col justify-center bg-white px-4 py-4 md:px-12 md:py-[60px]">
            <h3 className="mb-8 text-left text-[28px] font-bold text-[#111827]">
              How to get started
            </h3>

            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4">
                <span className="min-w-[16px] text-base font-bold text-[#111827]">1.</span>
                <div className="flex-1">
                  <div className="mb-1 text-base font-bold text-[#111827]">Upload Policies</div>
                  <div className="text-sm leading-[1.5] text-[#6b7280]">
                    Upload your organization&apos;s documents. Theraptly will analyze and prepare a
                    draft training automatically.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <span className="min-w-[16px] text-base font-bold text-[#111827]">2.</span>
                <div className="flex-1">
                  <div className="mb-1 text-base font-bold text-[#111827]">
                    Configure Course &amp; Assessment
                  </div>
                  <div className="text-sm leading-[1.5] text-[#6b7280]">
                    Define course structure, quiz settings, difficulty level, and deadlines.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <span className="min-w-[16px] text-base font-bold text-[#111827]">3.</span>
                <div className="flex-1">
                  <div className="mb-1 text-base font-bold text-[#111827]">
                    Review &amp; Publish Course
                  </div>
                  <div className="text-sm leading-[1.5] text-[#6b7280]">
                    Review AI-generated lessons and quizzes, make adjustments, and approve for
                    publishing. Instantly make your training available for your team to access and
                    complete.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <span className="min-w-[16px] text-base font-bold text-[#111827]">4.</span>
                <div className="flex-1">
                  <div className="mb-1 text-base font-bold text-[#111827]">
                    Invite Workers to Course
                  </div>
                  <div className="text-sm leading-[1.5] text-[#6b7280]">
                    Assign courses to individuals or departments and track progress directly from
                    your dashboard.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
