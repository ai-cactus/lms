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
            const buttonClass = styles.trainingActionBtn;

            if (isCompleted) {
              buttonText = 'View Result';
              onClick = () => handleViewResultClick(course.id);
            } else if (isStarted && !isFailed) {
              buttonText = 'Continue';
            } else if (isFailed) {
              buttonText = 'Retry';
            }

            return (
              <div key={course.id} className={styles.trainingItem}>
                <div className={styles.trainingInfo}>
                  <div className={styles.trainingIcon}>
                    {/* Using a generic course icon or passed category icon */}
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
                    <h3 className={styles.trainingTitle}>{course.title}</h3>
                    <p className={styles.trainingCategory}>
                      {course.category ? formatCategory(course.category) : 'General'}
                    </p>
                  </div>
                </div>
                <button
                  className={buttonClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClick();
                  }}
                >
                  {buttonText}
                </button>
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
