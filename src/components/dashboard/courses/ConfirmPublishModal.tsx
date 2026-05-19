'use client';

import React, { useState } from 'react';
import { Modal, Button } from '@/components/ui';

interface ConfirmPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reviewerName: string) => void;
  courseTitle: string;
  isPublishing: boolean;
}

export default function ConfirmPublishModal({
  isOpen,
  onClose,
  onConfirm,
  courseTitle,
  isPublishing,
}: ConfirmPublishModalProps) {
  const [reviewer, setReviewer] = useState('John Smith');
  const [isConfirmed, setIsConfirmed] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      className="p-0 overflow-hidden"
      preventClose={isPublishing}
    >
      <div className="flex flex-col md:flex-row min-h-[400px]">
        {/* Left Side - Illustration Area */}
        <div className="hidden md:flex flex-col items-center justify-center bg-slate-50 w-2/5 p-6 border-r border-slate-100 relative">
          <div className="relative w-full max-w-[200px] aspect-square flex items-center justify-center">
            {/* The illustration requested in the image (A stylized M with a toast) */}
            <div className="absolute inset-0 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center p-4">
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* The blue M */}
                <path
                  d="M10 80 V 40 C 10 20, 45 20, 50 40 C 55 20, 90 20, 90 40 V 80"
                  stroke="#2563EB"
                  strokeWidth="15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </div>
            {/* Toast overlay */}
            <div className="absolute -bottom-6 -right-6 bg-white rounded-lg shadow-lg border border-slate-100 p-3 w-[220px]">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#16A34A"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <span className="text-sm font-bold text-slate-800">New Course Added!</span>
              </div>
              <div className="text-xs text-slate-500 pl-7">
                New course added to the organization!
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Content */}
        <div className="flex-1 p-8 flex flex-col">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Confirm Course Review</h2>

          <div className="text-sm text-slate-600 space-y-4 mb-6 flex-1">
            <p>
              Please confirm that the course content for{' '}
              <strong>&quot;{courseTitle || 'this course'}&quot;</strong> has been reviewed and
              approved by a qualified individual. This includes verifying the accuracy of the
              material, its alignment with organizational policies, and its relevance to the
              assigned staff.
            </p>
            <p>This confirmation will be recorded as part of the course audit trail.</p>
          </div>

          <div className="space-y-4 mb-8">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-slate-700">Reviewed by</label>
              <select
                className="w-full h-10 px-3 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                disabled={isPublishing}
              >
                <option value="John Smith">John Smith</option>
                <option value="Admin User">Admin User</option>
                <option value="Jane Doe">Jane Doe</option>
              </select>
            </div>

            <label className="flex items-start gap-3 cursor-pointer mt-4">
              <input
                type="checkbox"
                className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                checked={isConfirmed}
                onChange={(e) => setIsConfirmed(e.target.checked)}
                disabled={isPublishing}
              />
              <span className="text-sm text-slate-700">
                I confirm that this course has been <strong>reviewed and approved</strong> before
                publishing.
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 mt-auto">
            <Button variant="outline" onClick={onClose} disabled={isPublishing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => onConfirm(reviewer)}
              disabled={!isConfirmed || isPublishing}
              loading={isPublishing}
            >
              Publish
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
