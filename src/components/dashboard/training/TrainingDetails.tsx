'use client';

import React, { useState } from 'react';
import styles from './TrainingDetails.module.css';
import { Button, Input } from '@/components/ui';
import Link from 'next/link';
import ShareCourseModal from './ShareCourseModal';

import { CourseWithRelations } from '@/types/course';

interface TrainingDetailsProps {
  course: CourseWithRelations;
}

export default function TrainingDetails({ course }: TrainingDetailsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'staff' | 'certificates'>('staff');

  // Use real enrollments from database only
  const enrollments = course.enrollments || [];

  const totalLearners = enrollments.length;

  // Calculate Stats
  const completedCount = enrollments.filter((e) => e.status === 'completed').length;
  const completionRate = totalLearners > 0 ? Math.round((completedCount / totalLearners) * 100) : 0;

  // Average Score
  const scoredEnrollments = enrollments.filter((e) => e.score !== null);
  const averageScore =
    scoredEnrollments.length > 0
      ? Math.round(
          scoredEnrollments.reduce((sum: number, e) => sum + (e.score || 0), 0) /
            scoredEnrollments.length,
        )
      : 0;

  // Filter enrollments based on search query
  const filteredEnrollments = enrollments.filter((e) => {
    const q = searchQuery.toLowerCase();
    const nameMatch = e.user?.profile?.fullName?.toLowerCase().includes(q);
    const emailMatch = e.user?.email.toLowerCase().includes(q);
    return nameMatch || emailMatch;
  });

  return (
    <div className={styles.container}>
      {/* Breadcrumbs & Header */}
      {/* Breadcrumbs & Header */}
      <div className={styles.headerContainer}>
        <div className={styles.breadcrumbs}>
          <Link href="/dashboard/courses" className={styles.backButton}>
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
          </Link>
          <span>Course</span> <span className={styles.separator}>/</span>{' '}
          <span className={styles.activeBreadcrumb}>Course Details</span>
        </div>

        <div className={styles.header}>
          <div className={styles.titleSection}>
            <h1 className={styles.title}>{course.title}</h1>
            <p className={styles.metaLink}>
              Mandatory annual training aligned with organizational standards
            </p>
            <div className={styles.approvalSection}>
              <span className={styles.approvedBy}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="#38A169"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: 6 }}
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="9 12 11 14 15 10"></polyline>
                </svg>
                <strong>Approved by: Admin</strong>
              </span>
            </div>
            <div className={styles.courseBadges}>
              <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
              <span className={styles.metaBadge}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ marginRight: 6 }}
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                {course.duration || 10} min read
              </span>
              <span className={styles.metaBadge}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ marginRight: 6 }}
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                Pass mark:{' '}
                {course.lessons?.find((l) => (l as { quiz?: { passingScore?: number } }).quiz)?.quiz
                  ?.passingScore || 80}
                %
              </span>
            </div>
          </div>
          <div className={styles.actions}>
            <Link href={`/dashboard/training/courses/${course.id}/preview`}>
              <Button variant="primary" size="lg" style={{ backgroundColor: '#4C6EF5' }}>
                Preview
              </Button>
            </Link>
            <Button
              variant="outline"
              className={styles.outlineButton}
              size="lg"
              onClick={() => setIsShareModalOpen(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: 8 }}
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="8.5" cy="7" r="4"></circle>
                <line x1="20" y1="8" x2="20" y2="14"></line>
                <line x1="23" y1="11" x2="17" y2="11"></line>
              </svg>
              Assign
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className={styles.statsGrid}>
        {/* Total Learners */}
        <div className={`${styles.statCard} ${styles.cardBlue}`}>
          <div className={`${styles.iconBox} ${styles.iconBlue}`}>
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
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div className={styles.statInfo}>
            <h4>Total Learners</h4>
            <div className={styles.statValue}>{totalLearners}</div>
          </div>
        </div>

        {/* Completion Rate */}
        <div className={`${styles.statCard} ${styles.cardGreen}`}>
          <div className={`${styles.iconBox} ${styles.iconGreen}`}>
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
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <div className={styles.statInfo}>
            <h4>Completion Rate</h4>
            <div className={styles.statValue}>{completionRate}%</div>
          </div>
        </div>

        {/* Average Score */}
        <div className={`${styles.statCard} ${styles.cardRed}`}>
          <div className={`${styles.iconBox} ${styles.iconRed}`}>
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
              <circle cx="12" cy="8" r="7"></circle>
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
            </svg>
          </div>
          <div className={styles.statInfo}>
            <h4>Average Score</h4>
            <div className={styles.statValue}>{averageScore}%</div>
          </div>
        </div>

        {/* Duration */}
        <div className={`${styles.statCard} ${styles.cardYellow}`}>
          <div className={`${styles.iconBox} ${styles.iconYellow}`}>
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
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <div className={styles.statInfo}>
            <h4>Estimated Duration</h4>
            <div className={styles.statValue}>{course.duration || 0} mins</div>
          </div>
        </div>
      </div>

      <div className={styles.staffSection}>
        <div
          style={{
            display: 'flex',
            gap: '24px',
            borderBottom: '1px solid #E2E8F0',
            marginBottom: '24px',
          }}
        >
          <button
            className={activeTab === 'staff' ? styles.tabActive : styles.tabInactive}
            onClick={() => setActiveTab('staff')}
          >
            Enrolled Staff
          </button>
          <button
            className={activeTab === 'certificates' ? styles.tabActive : styles.tabInactive}
            onClick={() => setActiveTab('certificates')}
          >
            Certificates Issued
          </button>
        </div>

        {activeTab === 'staff' ? (
          <>
            <div className={styles.searchContainer}>
              <Input
                placeholder="Search for staff..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
                leftIcon={
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: '#aaa' }}
                  >
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                }
              />
              <button className={styles.exportButton}>
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Export
              </button>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Staff Name</th>
                  <th style={{ width: '20%' }}>Score</th>
                  <th style={{ width: '20%' }}>Status</th>
                  <th style={{ width: '20%', textAlign: 'right' }}>Quiz result</th>
                </tr>
              </thead>
              <tbody>
                {filteredEnrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td>
                      <div className={styles.staffProfile}>
                        <div className={styles.avatar}>
                          {(
                            enrollment.user?.profile?.fullName?.[0] ||
                            enrollment.user?.email?.[0] ||
                            '?'
                          ).toUpperCase()}
                        </div>
                        <div>
                          <span className={styles.staffName}>
                            {enrollment.user?.profile?.fullName || enrollment.user?.email}
                          </span>
                          <span className={styles.staffRole}>
                            {enrollment.user?.role || 'Staff'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={styles.score}>
                        {enrollment.score !== null ? `${enrollment.score}%` : '-'}
                      </span>
                    </td>
                    <td>
                      {(enrollment.status === 'completed' || enrollment.status === 'attested') &&
                      (enrollment.score ?? 0) >= 70 ? (
                        <span className={`${styles.statusBadge} ${styles.passed}`}>
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
                      ) : enrollment.status === 'completed' || enrollment.status === 'attested' ? (
                        <span className={`${styles.statusBadge} ${styles.failed}`}>
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
                      ) : enrollment.status === 'lessons_complete' ? (
                        <span className={`${styles.statusBadge} ${styles.inProgress}`}>
                          <svg
                            width="12"
                            height="12"
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
                          Awaiting Quiz
                        </span>
                      ) : enrollment.status === 'in_progress' || enrollment.progress > 0 ? (
                        <span className={`${styles.statusBadge} ${styles.inProgress}`}>
                          <svg
                            width="12"
                            height="12"
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
                          In Progress
                        </span>
                      ) : (
                        <span className={`${styles.statusBadge} ${styles.notStarted}`}>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10"></circle>
                          </svg>
                          Not Started
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          gap: 12,
                          alignItems: 'center',
                        }}
                      >
                        {enrollment.score !== null ? (
                          <Link
                            href={`/dashboard/training/courses/${course.id}/results/${enrollment.id}`}
                          >
                            <span className={styles.viewResultText}>View Result</span>
                          </Link>
                        ) : (
                          <span
                            className={styles.viewResultText}
                            style={{ color: '#cbd5e0', cursor: 'not-allowed' }}
                          >
                            View Result
                          </span>
                        )}
                        <button className={styles.dotsButton} title="More actions">
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
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="12" cy="5" r="1"></circle>
                            <circle cx="12" cy="19" r="1"></circle>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredEnrollments.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: '#718096', padding: 24 }}>
                      No staff enrolled yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        ) : (
          <div className="space-y-4">
            {enrollments.filter((e) => e.certificate).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#718096', padding: 24 }}>
                No certificates have been issued for this course yet.
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Staff Name</th>
                    <th style={{ width: '30%' }}>Issue Date</th>
                    <th style={{ width: '30%', textAlign: 'right' }}>Certificate</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments
                    .filter((e) => e.certificate)
                    .map((enrollment) => (
                      <tr key={enrollment.id}>
                        <td>
                          <div className={styles.staffProfile}>
                            <div className={styles.avatar}>
                              {(
                                enrollment.user?.profile?.fullName?.[0] ||
                                enrollment.user?.email?.[0] ||
                                '?'
                              ).toUpperCase()}
                            </div>
                            <div>
                              <span className={styles.staffName}>
                                {enrollment.user?.profile?.fullName || enrollment.user?.email}
                              </span>
                              <span className={styles.staffRole}>
                                {enrollment.user?.role || 'Staff'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>{new Date(enrollment.certificate!.issuedAt).toLocaleDateString()}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              window.open(
                                `/api/certificates/${enrollment.certificate!.id}`,
                                '_blank',
                              )
                            }
                          >
                            View PDF
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
      <ShareCourseModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        courseId={course.id}
      />
    </div>
  );
}
