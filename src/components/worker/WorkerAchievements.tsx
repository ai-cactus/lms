'use client';

import React from 'react';
import Link from 'next/link';
import styles from './WorkerDashboard.module.css';

interface RecentCertificate {
  id: string;
  courseTitle: string;
  issuedAt: Date;
}

interface WorkerAchievementsProps {
  badgeCount: number;
  recentCertificates?: RecentCertificate[];
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function WorkerAchievements({
  badgeCount,
  recentCertificates = [],
}: WorkerAchievementsProps) {
  return (
    <section className={styles.achievementsSection}>
      <div className="flex items-center justify-between">
        <h2 className={styles.sectionTitle}>Courses Completed</h2>
        {badgeCount > 0 && (
          <Link
            href="/worker/certificates"
            className="text-sm font-semibold text-[#4C6EF5] flex items-center gap-1 hover:underline"
          >
            View all certificates
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
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        )}
      </div>

      <div
        className={styles.achievementsCard}
        style={{ alignItems: 'flex-start', justifyContent: 'flex-start', padding: '28px 32px' }}
      >
        {recentCertificates.length > 0 ? (
          <div className="w-full flex flex-col gap-3">
            {/* Summary line */}
            <p className={styles.achievementsText}>
              You have earned{' '}
              <strong>
                {badgeCount} certificate{badgeCount !== 1 ? 's' : ''}
              </strong>
            </p>

            {/* Certificate cards */}
            <div className="flex flex-col gap-3 mt-1">
              {recentCertificates.map((cert, index) => (
                <div
                  key={cert.id}
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#e2e8f0] bg-[#f8faff] hover:border-[#4C6EF5]/40 hover:bg-[#eef2ff] transition-colors duration-150"
                >
                  {/* Medal / rank indicator */}
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                    style={{
                      background:
                        index === 0
                          ? 'linear-gradient(135deg, #fbbf24, #f59e0b)'
                          : index === 1
                            ? 'linear-gradient(135deg, #94a3b8, #64748b)'
                            : 'linear-gradient(135deg, #cd7c3c, #a85a23)',
                      color: 'white',
                    }}
                  >
                    {index + 1}
                  </div>

                  {/* Certificate icon */}
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white border border-[#e2e8f0] flex items-center justify-center shadow-sm">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#4C6EF5"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="8" r="6" />
                      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                    </svg>
                  </div>

                  {/* Course details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1a202c] truncate">
                      {cert.courseTitle}
                    </p>
                    <p className="text-xs text-[#718096] mt-0.5">
                      Issued on {formatDate(cert.issuedAt)}
                    </p>
                  </div>

                  {/* View link */}
                  <Link
                    href="/worker/certificates"
                    className="flex-shrink-0 text-xs font-semibold text-[#4C6EF5] px-3 py-1.5 rounded-lg border border-[#4C6EF5]/30 hover:bg-[#4C6EF5] hover:text-white transition-colors duration-150 whitespace-nowrap"
                  >
                    View
                  </Link>
                </div>
              ))}
            </div>

            {/* Footer CTA when there are more certificates than shown */}
            {badgeCount > 3 && (
              <div className="mt-2 text-center">
                <Link
                  href="/worker/certificates"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#4C6EF5] hover:underline"
                >
                  +{badgeCount - 3} more certificate{badgeCount - 4 !== 0 ? 's' : ''} — see all
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
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              </div>
            )}
          </div>
        ) : (
          /* Empty state */
          <div className={styles.achievementsContent}>
            <p className={styles.achievementsText}>
              You have earned <strong>0 certificates</strong>
            </p>
            <p className={styles.achievementsSubtext}>
              Currently, there are no certificates on your profile. Complete a course to earn your
              first certificate and showcase your accomplishments.
            </p>
            <Link
              href="/worker/trainings"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-[#4C6EF5] text-white text-sm font-semibold hover:bg-[#3b5de0] transition-colors"
            >
              Browse Courses
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
