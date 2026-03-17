'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';
import { useRouter } from 'next/navigation';

function formatCategory(category: string): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface Course {
  id: string;
  title: string;
  category?: string | null;
  status: string;
  progress: number;
  deadline?: Date | string | null;
  duration?: number;
  retakeOf?: string | null;
  enrollmentId?: string;
}

interface WorkerTrainingListProps {
  courses: Course[];
}

export default function WorkerTrainingList({ courses }: WorkerTrainingListProps) {
  const router = useRouter();

  const handleStartClick = (courseId: string) => {
    router.push(`/learn/${courseId}`);
  };

  const handleViewResultClick = (courseId: string) => {
    router.push(`/worker/courses/${courseId}`);
  };

  return (
    <section className={styles.trainingListSection}>
      <div className={styles.trainingList}>
        {courses.length > 0 ? (
          courses.map((course) => {
            const isCompleted = course.status === 'completed' || course.status === 'attested';
            const isStarted = course.progress > 0;
            const isFailed = course.status === 'failed';

            // Button Logic
            let buttonText = 'Start Course';
            let onClick = () => handleStartClick(course.id);
            let buttonClass = styles.trainingActionBtn;

            if (course.status === 'locked') {
              buttonText = 'Locked';
              buttonClass = `${styles.trainingActionBtn} ${styles.disabledBtn}`;
              onClick = () => {};
            } else if (isCompleted) {
              buttonText = 'View Result';
              onClick = () => handleViewResultClick(course.id);
            } else if (isStarted && !isFailed) {
              buttonText = 'Continue';
            } else if (isFailed) {
              buttonText = 'Retry';
            }

            return (
              <div key={course.id + '-' + course.enrollmentId} className={styles.trainingItem}>
                <div className={styles.trainingInfo}>
                  <div className={styles.trainingIcon}>
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
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <div className={styles.trainingDetails}>
                    <h3 className={styles.trainingTitle}>
                      {course.retakeOf ? (
                        <span style={{ color: '#E53E3E', fontWeight: 600, marginRight: 8 }}>
                          Retake:
                        </span>
                      ) : null}
                      {course.title}
                    </h3>
                    <p className={styles.trainingCategory}>
                      {course.category ? formatCategory(course.category) : 'General'}
                    </p>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '4px',
                  }}
                >
                  <button
                    className={buttonClass}
                    style={
                      course.status === 'locked'
                        ? {
                            opacity: 0.5,
                            cursor: 'not-allowed',
                            backgroundColor: '#CBD5E1',
                            color: '#475569',
                          }
                        : {}
                    }
                    disabled={course.status === 'locked'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClick();
                    }}
                  >
                    {buttonText}
                  </button>
                  {course.status === 'locked' && (
                    <span style={{ fontSize: '10px', color: '#EF4444' }}>
                      Waiting for admin retake
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className={styles.emptyTable}>
            <p>No trainings assigned.</p>
          </div>
        )}
      </div>
    </section>
  );
}
