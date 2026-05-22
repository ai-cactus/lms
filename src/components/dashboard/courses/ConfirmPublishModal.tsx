'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Modal, Button } from '@/components/ui';
import styles from './ConfirmPublishModal.module.css';
import { getCourses } from '@/app/actions/course';
import { CourseWithStats } from '@/types/course';

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
        .catch(console.error);
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      preventClose={isPublishing}
      /* Zero out the Modal's default 24px content padding */
      contentClassName={styles.noPad}
    >
      <div className={styles.wrapper}>
        {/* ── Left Illustration Panel ───────────────────────── */}
        <div className={styles.leftPanel}>
          {/* Logo card */}
          <div className={styles.logoCard}>
            <div className={styles.logoImgWrap}>
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
                className={styles.logoImg}
                priority
              />
            </div>
            <div className={styles.coursesLabel}>
              Courses <span aria-hidden="true">✨</span>
            </div>
          </div>

          {/* Toast notification */}
          <div className={styles.toast}>
            <div className={styles.toastHeader}>
              <div className={styles.toastIconWrap}>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#16A34A"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <span className={styles.toastTitle}>New Course Added!</span>
            </div>
            <p className={styles.toastBody}>New course added to the organization!</p>
          </div>

          {/* Illustrative course list */}
          <div className={styles.courseList}>
            {previewList.map((course) => (
              <div key={course.num} className={styles.courseItem}>
                <span className={styles.courseNum}>{course.num}.</span>
                <div
                  className={styles.courseIconCircle}
                  style={{ background: course.color }}
                  aria-hidden="true"
                >
                  {course.initials}
                </div>
                <div className={styles.courseInfo}>
                  <span className={styles.courseName}>{course.label}</span>
                  <span className={styles.courseRole}>{course.role}</span>
                </div>
                <div className={styles.courseCheck} aria-hidden="true">
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#4C6EF5"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right Content Panel ───────────────────────────── */}
        <div className={styles.rightPanel}>
          <h2 className={styles.heading}>Confirm Course Review</h2>

          <div className={styles.body}>
            <p>
              Please confirm that the course content for{' '}
              <strong>&quot;{courseTitle || 'this course'}&quot;</strong> has been reviewed and
              approved by a qualified individual. This includes verifying the accuracy of the
              material, its alignment with organizational policies, and its relevance to the
              assigned staff.
            </p>
            <p>This confirmation will be recorded as part of the course audit trail.</p>
          </div>

          <div className={styles.formGroup}>
            {/* Reviewer — read-only input pre-filled with the admin's name */}
            <div className={styles.fieldRow}>
              <label htmlFor="confirm-reviewer" className={styles.reviewLabel}>
                Reviewed by
              </label>
              <input
                id="confirm-reviewer"
                type="text"
                className={styles.reviewInput}
                value={reviewerName}
                readOnly
                aria-label="Reviewer name"
              />
            </div>

            {/* Confirmation checkbox */}
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={isConfirmed}
                onChange={(e) => setIsConfirmed(e.target.checked)}
                disabled={isPublishing}
              />
              <span className={styles.checkText}>
                I confirm that this course has been <strong>reviewed and approved</strong> before
                publishing.
              </span>
            </label>
          </div>

          <div className={styles.actions}>
            <Button variant="outline" onClick={onClose} disabled={isPublishing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
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
