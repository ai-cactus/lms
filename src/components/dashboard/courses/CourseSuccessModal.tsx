'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Modal, Button } from '@/components/ui';
import ShareCourseModal from '../training/ShareCourseModal';
import styles from './CourseSuccessModal.module.css';

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
    <Modal isOpen={isOpen} onClose={handleFinish} size="md" preventClose>
      <div className={styles.modalContainer}>
        {/* Ambient background glow */}
        <div className={styles.glowBackground}></div>

        {/* 3D Illustration */}
        <div className={styles.illustrationContainer}>
          <Image
            src="/images/course_success.png"
            alt="Success Checkmark"
            width={200}
            height={200}
            className={styles.illustration}
            priority
          />
        </div>

        <h2 className={styles.title}>
          Course <span>Published!</span>
        </h2>

        {courseTitle && (
          <div className={styles.courseNameWrapper}>
            <div className={styles.courseLabel}>Course Title</div>
            <div className={styles.courseName}>
              {/* Small document icon next to title */}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: '#0ea5e9' }}
              >
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
              {courseTitle}
            </div>
          </div>
        )}

        <p className={styles.description}>
          Your training material is ready. You can assign it to your team now, or manage it later
          from the training dashboard.
        </p>

        <div className={styles.actions}>
          <Button variant="primary" fullWidth onClick={() => setShowShareModal(true)} size="md">
            Assign to Workers
          </Button>
          <Button variant="outline" fullWidth onClick={handleFinish} size="md">
            Go to Training Dashboard
          </Button>
        </div>
      </div>
    </Modal>
  );
}
