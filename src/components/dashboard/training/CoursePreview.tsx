'use client';

import React, { useState } from 'react';
import styles from './CoursePreview.module.css';
import { Button } from '@/components/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { CourseWithRelations, EnrollmentWithRelations } from '@/types/course';

interface CoursePreviewProps {
  course: CourseWithRelations;
  mode?: 'admin' | 'worker';
  user?: { name?: string | null; email?: string | null }; // Current user details
  enrollment?: EnrollmentWithRelations | null; // Enrollment details
}

import { startCourse } from '@/app/actions/course';
import { requestCourseRetry } from '@/app/actions/enrollment';

function WorkerStartButton({
  courseId,
  enrollment,
}: {
  courseId: string;
  enrollment: EnrollmentWithRelations | null | undefined;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Determine status
  const isStarted = (enrollment?.progress || 0) > 0 || enrollment?.status === 'in_progress';
  const isCompleted = enrollment?.status === 'completed' || enrollment?.status === 'attested';
  const isFailed = enrollment?.status === 'failed';
  const isRetryRequested = enrollment?.status === 'retry_requested';

  // Determine button text
  let buttonText = 'Start Course';
  if (loading) buttonText = 'Processing...';
  else if (isCompleted) buttonText = 'Review Course';
  else if (isFailed) buttonText = 'Request Retry';
  else if (isRetryRequested) buttonText = 'Retry Requested';
  else if (isStarted) buttonText = 'Continue Course';

  const handleClick = async () => {
    if (isCompleted) {
      router.push(`/learn/${courseId}`);
      return;
    }

    if (isRetryRequested) {
      return; // Do nothing
    }

    try {
      setLoading(true);

      if (isFailed && enrollment?.id) {
        // Handle retry request
        await requestCourseRetry(enrollment.id);
        // The server action revalidates the path, but we can also refresh
        router.refresh();
        setLoading(false);
        return;
      }

      await startCourse(courseId);
      router.push(`/learn/${courseId}`);
    } catch (error) {
      console.error('Failed to start/retry course:', error);
      // Fallback navigation even if action fails (e.g. network)
      if (!isFailed) {
        router.push(`/learn/${courseId}`);
      }
      setLoading(false);
    }
  };

  return (
    <Button
      className={styles.startCourseButton}
      onClick={handleClick}
      disabled={loading || isRetryRequested}
      variant={isFailed ? 'outline' : 'primary'}
    >
      {buttonText}
    </Button>
  );
}

export default function CoursePreview({
  course,
  mode = 'admin',
  user,
  enrollment,
}: CoursePreviewProps) {
  const [activeTab, setActiveTab] = useState('About');

  return (
    <div className={styles.container}>
      {/* Dark Header Section */}
      <div className={styles.heroSection}>
        <div className={styles.heroContent}>
          <div className={styles.breadcrumbs}>
            <Link
              href={`/dashboard/training/courses/${course.id}`}
              className={styles.breadcrumbLink}
            >
              Course
            </Link>
            <span className={styles.separator}>/</span>
            <span className={styles.currentBreadcrumb}>{course.title}</span>
          </div>

          <h1 className={styles.title}>{course.title}</h1>
          <p className={styles.description}>
            {course.description || 'Mandatory annual training aligned with CARF 1.H 4. a-b'}
          </p>
          <p className={styles.author}>
            By {course.creator?.profile?.fullName || course.creator?.email || 'Unknown Author'}
          </p>

          <div className={styles.metaRow}>
            <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
            <div className={styles.metaItem}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              {course.duration || 0} min read
            </div>
            {course.lessons?.some((l) => (l as { quiz?: unknown }).quiz) && (
              <div className={styles.metaItem}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                Pass mark:{' '}
                {course.lessons.find((l) => (l as { quiz?: { passingScore: number } }).quiz)?.quiz
                  ?.passingScore || 70}
                %
              </div>
            )}
          </div>

          <div className={styles.heroActions}>
            {mode === 'worker' ? (
              <WorkerStartButton courseId={course.id} enrollment={enrollment} />
            ) : (
              <Link href={`/learn/${course.id}`}>
                <Button className={styles.startCourseButton}>View Course</Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={styles.mainLayout}>
        {/* Left Column */}
        <div className={styles.contentColumn}>
          <div className={styles.mainCard}>
            {/* Tabs */}
            <div className={styles.tabs}>
              {['About'].map((tab) => (
                <button
                  key={tab}
                  className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'About' && (
              <div className={styles.tabContent}>
                <h2 className={styles.sectionTitle}>Course Overview</h2>
                <p className={styles.text}>{course.description || 'No description available.'}</p>

                {course.objectives && course.objectives.length > 0 && (
                  <>
                    <h3 className={styles.subTitle}>What You&apos;ll Learn</h3>
                    <ul className={styles.learnList}>
                      {course.objectives.map((objective: string, index: number) => (
                        <li key={index}>{objective}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Sidebar) */}
        <div className={styles.sidebarColumn}>
          {/* Attestation Status Card */}
          {enrollment?.status === 'attested' && (
            <div
              className={styles.sidebarCard}
              style={{
                marginBottom: 24,
                padding: 24,
                border: '1px solid #E9D8FD',
                backgroundColor: '#FAF5FF',
              }}
            >
              <h3 className={styles.sidebarTitle} style={{ marginBottom: 16 }}>
                Attestation status
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    backgroundColor: '#E2E8F0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#4A5568',
                  }}
                >
                  {(user?.name?.[0] || 'U').toUpperCase()}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: '#1A202C' }}>
                      {user?.name || 'User'}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        backgroundColor: '#E2E8F0',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      You
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#718096' }}>{user?.email}</div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
                Course: &quot;{course.title}&quot;
              </div>

              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: '#DEF7EC',
                    color: '#03543F',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 12,
                  }}
                >
                  Signed
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: '#4C6EF5',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  View details
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ marginLeft: 2 }}
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
              </div>
            </div>
          )}

          <div className={styles.sidebarCard}>
            <h3 className={styles.sidebarTitle}>Table of Content</h3>
            <div className={styles.lessonsList}>
              {course.lessons && course.lessons.length > 0 ? (
                course.lessons.map((lesson) => (
                  <div key={lesson.id} className={styles.lessonItem}>
                    <span className={styles.lessonTitle}>{lesson.title}</span>
                  </div>
                ))
              ) : (
                <div
                  className={styles.lessonItem}
                  style={{ color: '#718096', fontStyle: 'italic' }}
                >
                  No content available yet.
                </div>
              )}
            </div>

            <div className={styles.divider}></div>

            <div className={styles.courseMeta}>
              {/* Skill Level - Try to get from quiz or hide */}
              {course.lessons?.some(
                (l) => (l as { quiz?: { difficulty?: string } }).quiz?.difficulty,
              ) && (
                <div className={styles.metaRowSidebar}>
                  <span className={styles.metaLabel}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: '#A0AEC0' }}
                    >
                      <path d="M12 20V10"></path>
                      <path d="M18 20V4"></path>
                      <path d="M6 20v-4"></path>
                    </svg>
                    Skill Level
                  </span>
                  <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>
                    {(
                      course.lessons.find(
                        (l) => (l as { quiz?: { difficulty?: string } }).quiz?.difficulty,
                      ) as { quiz?: { difficulty?: string } }
                    )?.quiz?.difficulty || 'General'}
                  </span>
                </div>
              )}

              <div className={styles.metaRowSidebar}>
                <span className={styles.metaLabel}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: '#A0AEC0' }}
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  Duration
                </span>
                <span className={styles.metaValue}>{course.duration || 0} mins</span>
              </div>
              <div className={styles.metaRowSidebar}>
                <span className={styles.metaLabel}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: '#A0AEC0' }}
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  Last Updated
                </span>
                <span className={styles.metaValue}>
                  {new Date(course.updatedAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
