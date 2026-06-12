'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { getCourses } from '@/app/actions/course';
import { CourseWithStats } from '@/types/course';
import { logger } from '@/lib/logger';

interface ConfirmPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reviewerName: string) => void;
  courseTitle: string;
  isPublishing: boolean;
}

const COLORS = ['#22C55E', '#F97316', '#64748B', '#3B82F6', '#8B5CF6', '#EC4899'];

function getInitials(title: string) {
  if (!title) return 'C';
  const parts = title.split(' ').filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getColorForString(str: string) {
  if (!str) return COLORS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

type PreviewCourse = {
  num: number;
  label: string;
  role: string;
  color: string;
  initials: string;
};

export default function ConfirmPublishModal({
  isOpen,
  onClose,
  onConfirm,
  courseTitle,
  isPublishing,
}: ConfirmPublishModalProps) {
  const { data: session } = useSession();
  // Pre-fill reviewer with the logged-in admin name; falls back gracefully
  const reviewerName = session?.user?.name ?? 'Admin';

  const [isConfirmed, setIsConfirmed] = useState(false);
  const [recentCourses, setRecentCourses] = useState<CourseWithStats[]>([]);

  React.useEffect(() => {
    if (isOpen) {
      getCourses()
        .then((courses) => {
          setRecentCourses(courses.slice(0, 2));
        })
        .catch((err) => logger.error({ msg: 'Failed to load courses for publish preview', err }));
    }
  }, [isOpen]);

  const handleConfirm = () => {
    onConfirm(reviewerName);
  };

  const previewList: PreviewCourse[] = [
    {
      num: 1,
      label: courseTitle || 'New Course',
      role: 'New',
      color: getColorForString(courseTitle || 'New Course'),
      initials: getInitials(courseTitle || 'New Course'),
    },
    ...recentCourses.map((c, i) => ({
      num: i + 2,
      label: c.title.length > 20 ? c.title.substring(0, 17) + '...' : c.title,
      role: 'General',
      color: getColorForString(c.title),
      initials: getInitials(c.title),
    })),
  ];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPublishing) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Confirm Course Review</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[90vh] flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* ── Left Illustration Panel ───────────────────────── */}
          <div className="flex w-full shrink-0 flex-col gap-2.5 overflow-hidden bg-[#eef1fb] p-4 pt-5 md:w-[42%]">
            {/* Logo card */}
            <div className="flex min-h-0 flex-1 flex-col items-center overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
              <div className="flex w-full flex-1 items-center justify-center overflow-hidden px-3 pt-5">
                {/*
                 * Use the actual Logomark SVG (not a hand-drawn M path).
                 * The image fills the card width so the full logomark is visible
                 * and the lower portion is not clipped by sibling elements.
                 */}
                <Image
                  src="/images/Logomark.svg"
                  alt="Logomark"
                  width={200}
                  height={164}
                  className="block h-auto max-h-40 w-full object-contain"
                  priority
                />
              </div>
              <div className="flex w-full shrink-0 items-center gap-1.5 border-t border-[#f1f5f9] px-4 py-2.5 text-sm font-bold text-[#1a202c]">
                Courses <span aria-hidden="true">✨</span>
              </div>
            </div>

            {/* Toast notification */}
            <div className="shrink-0 rounded-[10px] bg-white p-2.5 px-3 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.08),0_2px_4px_-1px_rgba(0,0,0,0.04)]">
              <div className="mb-[3px] flex items-center gap-2">
                <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#dcfce7]">
                  <Check
                    className="size-[11px] text-[#16A34A]"
                    strokeWidth={3.5}
                    aria-hidden="true"
                  />
                </div>
                <span className="text-[13px] font-bold text-[#1a202c]">New Course Added!</span>
              </div>
              <p className="m-0 pl-7 text-[11px] text-[#6b7280]">
                New course added to the organization!
              </p>
            </div>

            {/* Illustrative course list */}
            <div className="flex shrink-0 flex-col gap-[5px]">
              {previewList.map((course) => (
                <div
                  key={course.num}
                  className="flex items-center gap-2 rounded-lg border border-[#f1f5f9] bg-white px-2.5 py-1.5"
                >
                  <span className="w-3.5 shrink-0 text-[11px] text-[#9ca3af]">{course.num}.</span>
                  <div
                    className="flex size-[26px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: course.color }}
                    aria-hidden="true"
                  >
                    {course.initials}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-[#374151]">
                      {course.label}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10px] text-[#9ca3af]">
                      {course.role}
                    </span>
                  </div>
                  <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#eff6ff]">
                    <Check
                      className="size-[9px] text-[#4C6EF5]"
                      strokeWidth={3.5}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right Content Panel ───────────────────────────── */}
          <div className="flex flex-1 flex-col p-7 pb-6">
            <h2 className="m-0 mb-4 text-lg font-bold text-[#1a202c]">Confirm Course Review</h2>

            <div className="mb-5 flex flex-1 flex-col gap-2.5 text-[13.5px] leading-relaxed text-[#4a5568]">
              <p className="m-0">
                Please confirm that the course content for{' '}
                <strong>&quot;{courseTitle || 'this course'}&quot;</strong> has been reviewed and
                approved by a qualified individual. This includes verifying the accuracy of the
                material, its alignment with organizational policies, and its relevance to the
                assigned staff.
              </p>
              <p className="m-0">
                This confirmation will be recorded as part of the course audit trail.
              </p>
            </div>

            <div className="mb-6 flex flex-col gap-4">
              {/* Reviewer — read-only input pre-filled with the admin's name */}
              <div className="flex items-center gap-4">
                <label
                  htmlFor="confirm-reviewer"
                  className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-[#374151]"
                >
                  Reviewed by
                </label>
                <Input
                  id="confirm-reviewer"
                  type="text"
                  className="h-[38px] flex-1 cursor-default bg-[#f8fafc] text-sm text-[#374151]"
                  value={reviewerName}
                  readOnly
                  aria-label="Reviewer name"
                />
              </div>

              {/* Confirmation checkbox */}
              <label htmlFor="confirm-checkbox" className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  id="confirm-checkbox"
                  className="mt-0.5 shrink-0"
                  checked={isConfirmed}
                  onCheckedChange={(c) => setIsConfirmed(c === true)}
                  disabled={isPublishing}
                />
                <span className="text-[13px] leading-snug text-[#374151]">
                  I confirm that this course has been <strong>reviewed and approved</strong> before
                  publishing.
                </span>
              </label>
            </div>

            <DialogFooter className="gap-3 sm:justify-end">
              <Button variant="outline" onClick={onClose} disabled={isPublishing}>
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleConfirm}
                disabled={!isConfirmed || isPublishing}
                loading={isPublishing}
              >
                Publish
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
