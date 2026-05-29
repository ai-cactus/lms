'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import styles from './WorkerWelcomeModal.module.css';
import { Modal, Button } from '@/components/ui';
import { useModalContext } from '@/components/ui/ModalContext';
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
    // Permanent dismiss
    dismissModal(modalId, -1);
    if (firstCourseId) {
      router.push(`/learn/${firstCourseId}`);
    }
  };

  const isOpen = isModalOpen(modalId);

  if (!hasMounted || !isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      className={styles.modalParams}
      showCloseButton={false} // We have a custom close button in design or we can use the default.
    >
      <div className={styles.container}>
        {/* Left Panel */}
        <div className={styles.leftPanel}>
          <div className={styles.blob} />
          {/* Illustration */}
          <div className={styles.illustration}>
            <Image
              src="/images/onboarding-welcome.png"
              alt="Welcome"
              width={280}
              height={280}
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>

          <h2 className={styles.welcomeTitle}>
            Your first training
            <br />
            course awaits you
          </h2>

          <p className={styles.welcomeText}>
            Join professionals learning with Theraply in a clear, accessible, and supportive way.
          </p>

          <Button
            variant="primary"
            size="lg"
            pill
            onClick={handleStart}
            style={{ marginTop: '24px', width: '100%', maxWidth: '240px' }}
          >
            Start your first course
          </Button>
        </div>

        {/* Right Panel */}
        <div className={styles.rightPanel}>
          <Button
            variant="ghost"
            size="icon-sm"
            className={styles.closeButton}
            onClick={handleClose}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </Button>

          <h3 className={styles.stepsTitle}>How to get started</h3>

          <div className={styles.stepsList}>
            <div className={styles.stepItem}>
              <div className={styles.stepNumber}>1.</div>
              <div className={styles.stepContent}>
                <div className={styles.stepHeading}>Log In to Your Dashboard</div>
                <div className={styles.stepDesc}>
                  Access your assigned courses in one place, right from your computer or phone.
                </div>
              </div>
            </div>

            <div className={styles.stepItem}>
              <div className={styles.stepNumber}>2.</div>
              <div className={styles.stepContent}>
                <div className={styles.stepHeading}>Complete your Courses and take quizzes.</div>
                <div className={styles.stepDesc}>
                  Training includes courses and quizzes. Access your assigned courses in one place,
                  right from your computer or phone.
                </div>
              </div>
            </div>

            <div className={styles.stepItem}>
              <div className={styles.stepNumber}>3.</div>
              <div className={styles.stepContent}>
                <div className={styles.stepHeading}>Earn Your Certificate</div>
                <div className={styles.stepDesc}>
                  Pass your training and instantly get a certificate you can use to prove
                  compliance.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
