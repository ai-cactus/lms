'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, Award } from 'lucide-react';

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
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#1a202c]">Courses Completed</h2>
        {badgeCount > 0 && (
          <Link
            href="/worker/certificates"
            className="flex items-center gap-1 text-sm font-semibold text-[#4C6EF5] hover:underline"
          >
            View all certificates
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      <div className="flex min-h-[200px] items-start justify-start rounded-xl border border-[#e2e8f0] bg-white px-8 py-7">
        {recentCertificates.length > 0 ? (
          <div className="flex w-full flex-col gap-3">
            {/* Summary line */}
            <p className="text-base text-[#1a202c]">
              You have earned{' '}
              <strong>
                {badgeCount} certificate{badgeCount !== 1 ? 's' : ''}
              </strong>
            </p>

            {/* Certificate cards */}
            <div className="mt-1 flex flex-col gap-3">
              {recentCertificates.map((cert, index) => (
                <div
                  key={cert.id}
                  className="flex items-center gap-4 rounded-xl border border-[#e2e8f0] bg-[#f8faff] p-4 transition-colors duration-150 hover:border-[#4C6EF5]/40 hover:bg-[#eef2ff]"
                >
                  {/* Medal / rank indicator */}
                  <div
                    className={[
                      'flex size-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                      index === 0
                        ? 'bg-gradient-to-br from-[#fbbf24] to-[#f59e0b]'
                        : index === 1
                          ? 'bg-gradient-to-br from-[#94a3b8] to-[#64748b]'
                          : 'bg-gradient-to-br from-[#cd7c3c] to-[#a85a23]',
                    ].join(' ')}
                  >
                    {index + 1}
                  </div>

                  {/* Certificate icon */}
                  <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white shadow-sm">
                    <Award className="size-[18px] text-[#4C6EF5]" aria-hidden="true" />
                  </div>

                  {/* Course details */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#1a202c]">
                      {cert.courseTitle}
                    </p>
                    <p className="mt-0.5 text-xs text-[#718096]">
                      Issued on {formatDate(cert.issuedAt)}
                    </p>
                  </div>

                  {/* View link */}
                  <Link
                    href="/worker/certificates"
                    className="flex-shrink-0 whitespace-nowrap rounded-lg border border-[#4C6EF5]/30 px-3 py-1.5 text-xs font-semibold text-[#4C6EF5] transition-colors duration-150 hover:bg-[#4C6EF5] hover:text-white"
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
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
        ) : (
          /* Empty state */
          <div className="max-w-[800px]">
            <p className="mb-2 text-base text-[#1a202c]">
              You have earned <strong>0 certificates</strong>
            </p>
            <p className="text-sm leading-relaxed text-[#718096]">
              Currently, there are no certificates on your profile. Complete a course to earn your
              first certificate and showcase your accomplishments.
            </p>
            <Link
              href="/worker/trainings"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#4C6EF5] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b5de0]"
            >
              Browse Courses
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
