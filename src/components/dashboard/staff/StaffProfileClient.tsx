'use client';

import React, { useState } from 'react';
import styles from './StaffProfile.module.css';
import { Button, Input } from '@/components/ui';

import EmptyTableState from '@/components/ui/EmptyTableState';
import Link from 'next/link';
import Image from 'next/image';
import EditStaffModal from './EditStaffModal';
import AssignUserCourseModal from './AssignUserCourseModal';
import AssignRetakeModal from '../training/AssignRetakeModal';
import QuizResults from '@/components/dashboard/training/QuizResults';
import { getEnrollmentQuizResult } from '@/app/actions/staff';

interface StaffProfileClientProps {
  staff: {
    user: {
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      role: string;
      jobTitle: string;
    };
    stats: {
      totalCourses: number;
      completedCourses: number;
      failedCourses: number;
      activeCourses: number;
    };
    enrollments: {
      id: string;
      courseId: string;
      courseName: string;
      progress: number;
      status: string;
      score: number;
      passingScore: number;
      difficulty?: string;
      quizAttempts?: {
        id: string;
        attemptCount: number;
        timeTaken: number | null;
      }[];
      allowedAttempts?: number;
    }[];
  };
}

export default function StaffProfileClient({ staff }: StaffProfileClientProps) {
  const { user, stats, enrollments } = staff;
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [retakeEnrollment, setRetakeEnrollment] = useState<{ id: string; courseName: string } | null>(
    null,
  );
  const [viewingResult, setViewingResult] = useState<{
    enrollmentId: string;
    courseName: string;
    score: number;
    passingScore?: number;
    answered: number;
    correct: number;
    wrong: number;
    time: number;
    questions: {
      id: string;
      text: string;
      options: { id: string; text: string }[];
      selectedAnswer: string;
      correctAnswer: string;
      explanation: string;
    }[];
  } | null>(null);
  const [isLoadingResult, setIsLoadingResult] = useState(false);

  const handleViewResult = async (enrollmentId: string) => {
    setIsLoadingResult(true);
    try {
      const result = await getEnrollmentQuizResult(enrollmentId);
      if (result) {
        setViewingResult({ ...result, enrollmentId });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingResult(false);
    }
  };

  // Filter enrollments
  const filteredEnrollments = enrollments.filter((e) =>
    e.courseName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className={styles.container}>
      {/* Breadcrumb */}
      <Link href="/dashboard/staff" className={styles.backLink}>
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
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Go Back
        <span>/</span>
        Staff Details
        <span>/</span>
        <span className={styles.activeCrumb}>Staff Profile</span>
      </Link>

      {/* Header */}
      <div className={styles.headerProfile}>
        <div className={styles.profileInfo}>
          <div className={styles.avatarLarge}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className={styles.avatarImage} />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '28px',
                  fontWeight: 600,
                }}
              >
                {(user.name.charAt(0) || 'U').toUpperCase()}
              </div>
            )}
          </div>
          <div className={styles.infoContent}>
            <h1 className={styles.name}>{user.name}</h1>
            <div className={styles.emailLine}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              {user.email}
            </div>
            <div className={styles.roleBadge}>
              {user.jobTitle || 'Direct Support Professional (DSP)'}
            </div>
          </div>
        </div>

        <div className={styles.headerActions} style={{ display: 'flex', gap: '8px' }}>
          <Button variant="ghost" size="md" onClick={() => setIsEditModalOpen(true)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit Profile
          </Button>
          <Button variant="primary" size="md" onClick={() => setIsAssignModalOpen(true)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Assign Course
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className={styles.statsRow}>
        <div className={`${styles.statsCard} ${styles.statsBlue}`}>
          <div className={`${styles.statsIcon} ${styles.iconBlue}`}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </div>
          <div className={styles.statsInfo}>
            <span className={styles.statsLabel}>Total Courses Assigned</span>
            <span className={styles.statsValue}>{stats.totalCourses}</span>
          </div>
        </div>

        <div className={`${styles.statsCard} ${styles.statsGreen}`}>
          <div className={`${styles.statsIcon} ${styles.iconGreen}`}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </div>
          <div className={styles.statsInfo}>
            <span className={styles.statsLabel}>Courses Completed</span>
            <span className={styles.statsValue}>{stats.completedCourses}</span>
          </div>
        </div>

        <div className={`${styles.statsCard} ${styles.statsRed}`}>
          <div className={`${styles.statsIcon} ${styles.iconRed}`}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </div>
          <div className={styles.statsInfo}>
            <span className={styles.statsLabel}>Failed / Retake Needed</span>
            <span className={styles.statsValue}>{stats.failedCourses}</span>
          </div>
        </div>

        <div className={`${styles.statsCard} ${styles.statsYellow}`}>
          <div className={`${styles.statsIcon} ${styles.iconYellow}`}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </div>
          <div className={styles.statsInfo}>
            <span className={styles.statsLabel}>Active / Due Soon</span>
            <span className={styles.statsValue}>{stats.activeCourses}</span>
          </div>
        </div>
      </div>

      {/* Courses Table */}
      <div className={styles.coursesSection}>
        <div className={styles.coursesHeader}>
          <h3 className={styles.coursesTitle}>Courses</h3>
          <div className={styles.searchWrapper}>
            <Input
              className=""
              style={{ width: '250px' }}
              placeholder="Search for courses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#A0AEC0"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              }
            />
          </div>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Name</th>
              <th style={{ width: '30%' }}>Progress</th>
              <th style={{ width: '15%' }}>Quiz Status</th>
              <th style={{ width: '15%' }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredEnrollments.map((enrollment) => (
              <tr key={enrollment.id}>
                <td>
                  <div className={styles.courseItem}>
                    <div className={styles.courseThumb}>
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                      </svg>
                    </div>
                    <div>
                      <span className={styles.courseName}>{enrollment.courseName}</span>
                      <span className={styles.courseLvl}>
                        {enrollment.difficulty || 'Advanced'}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <div className={styles.progressWrapper}>
                    <div className={styles.bgBar}>
                      <div
                        className={styles.fillBar}
                        style={{ width: `${enrollment.progress || 0}%` }}
                      ></div>
                    </div>
                    <span className={styles.pctText}>{enrollment.progress || 0}%</span>
                  </div>
                </td>
                <td>
                  {(enrollment.status === 'completed' || enrollment.progress === 100) &&
                  enrollment.score >= (enrollment.passingScore || 70) ? (
                    <span className={`${styles.badge} ${styles.badgePassed}`}>
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
                      Passed
                    </span>
                  ) : enrollment.status === 'locked' ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        alignItems: 'flex-start',
                      }}
                    >
                      <span
                        className={`${styles.badge} ${styles.badgeFailed}`}
                        style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}
                      >
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
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Locked
                      </span>
                      <span style={{ fontSize: '10px', color: '#E53E3E' }}>Limit reached</span>
                    </div>
                  ) : enrollment.status === 'completed' || enrollment.progress === 100 ? (
                    <span className={`${styles.badge} ${styles.badgeFailed}`}>
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
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                      Failed
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#718096' }}>In Progress</span>
                      {enrollment.quizAttempts && (
                        <span style={{ fontSize: '10px', color: '#A0AEC0', marginTop: '2px' }}>
                          Attempt{' '}
                          {Math.min(
                            enrollment.quizAttempts[0]
                              ? enrollment.quizAttempts[0].timeTaken === null
                                ? enrollment.quizAttempts[0].attemptCount
                                : enrollment.quizAttempts[0].attemptCount + 1
                              : 1,
                            enrollment.allowedAttempts || 99,
                          )}
                          {enrollment.allowedAttempts && ` of ${enrollment.allowedAttempts}`}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    {enrollment.status === 'locked' && (
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={() =>
                          setRetakeEnrollment({
                            id: enrollment.id,
                            courseName: enrollment.courseName,
                          })
                        }
                      >
                        Retake
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleViewResult(enrollment.id)}
                      disabled={isLoadingResult}
                      loading={isLoadingResult}
                    >
                      View
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredEnrollments.length === 0 && (
              <EmptyTableState
                message="No courses found."
                subMessage="This staff member has no enrolled courses."
                colSpan={4}
                asTableRow
              />
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <EditStaffModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        staff={{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          jobTitle: user.jobTitle,
        }}
      />

      <AssignUserCourseModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        userEmail={user.email}
        userName={user.name}
        enrolledCourseIds={enrollments.map((e) => e.courseId)}
        onSuccess={() => {
          window.location.reload();
        }}
      />

      <AssignRetakeModal
        isOpen={!!retakeEnrollment}
        onClose={() => setRetakeEnrollment(null)}
        enrollmentId={retakeEnrollment?.id || ''}
        courseName={retakeEnrollment?.courseName || ''}
        userName={user.name}
      />

      {viewingResult && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setViewingResult(null)}
        >
          <div
            style={{
              background: 'white',
              width: '90%',
              maxWidth: '800px',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: '16px',
              padding: '24px',
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon-md"
              onClick={() => setViewingResult(null)}
              style={{ position: 'absolute', top: '12px', right: '12px' }}
            >
              <svg
                width="18"
                height="18"
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
            <QuizResults
              courseId=""
              enrollmentId={viewingResult.enrollmentId}
              data={viewingResult}
              hideActions={true}
              userRole="admin"
            />
          </div>
        </div>
      )}
    </div>
  );
}
