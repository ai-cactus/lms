'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RowActionsMenu } from '@/components/ui';
import Link from 'next/link';
import ShareCourseModal from './ShareCourseModal';
import CertificateModal from './CertificateModal';
import AssignRetakeModal from './AssignRetakeModal';
import {
  ClipboardList,
  RotateCcw,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Calendar,
  Share2,
  Check,
  X,
  Search,
  Download,
  Users,
  Award,
  Activity,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

import { CourseWithRelations } from '@/types/course';

interface TrainingDetailsProps {
  course: CourseWithRelations;
}

export default function TrainingDetails({ course }: TrainingDetailsProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'staff' | 'certificates'>('staff');
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  const [retakeEnrollment, setRetakeEnrollment] = useState<{
    id: string;
    courseName: string;
  } | null>(null);

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
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      {/* Breadcrumbs & Header */}
      <div className="mb-8">
        {/* Breadcrumb */}
        <div className="mb-4 inline-flex items-center gap-2 text-sm text-[#718096]">
          <Link
            href="/dashboard/courses"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-[#4a5568] transition-colors hover:bg-[#f7fafc] hover:text-[#2d3748]"
          >
            <ArrowLeft className="size-4" />
            Go Back
          </Link>
          <span>Course</span>
          <span className="text-[#cbd5e0]">/</span>
          <span className="font-medium text-primary">Course Details</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-10 max-md:flex-col">
          <div className="flex-1">
            <h1 className="mb-3 text-2xl font-bold text-[#1a202c]">{course.title}</h1>
            <p className="text-sm text-[#718096]">
              Mandatory annual training aligned with organizational standards
            </p>
            <div className="mt-2 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0fff4] px-3 py-1 text-[13px] text-[#38a169]">
                <CheckCircle2 className="size-4 text-[#38A169]" />
                <strong>Approved by: Admin</strong>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-[#c6f6d5] px-3 py-1 text-[13px] font-medium text-[#22543d]">
                Active
              </span>
              <span className="inline-flex items-center rounded-full border border-[#e2e8f0] bg-[#f7fafc] px-3 py-1 text-[13px] text-[#718096]">
                <Clock className="mr-1.5 size-3.5" />
                {course.duration || 10} min read
              </span>
              <span className="inline-flex items-center rounded-full border border-[#e2e8f0] bg-[#f7fafc] px-3 py-1 text-[13px] text-[#718096]">
                <Calendar className="mr-1.5 size-3.5" />
                Pass mark:{' '}
                {course.lessons?.find((l) => (l as { quiz?: { passingScore?: number } }).quiz)?.quiz
                  ?.passingScore || 80}
                %
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href={`/dashboard/training/courses/${course.id}/preview`}>
              <Button size="lg">Preview</Button>
            </Link>
            <Button variant="outline" size="lg" onClick={() => setIsShareModalOpen(true)}>
              <Share2 className="size-4" />
              Assign
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Total Learners */}
        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#bee3f8] bg-[#ebf8ff]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#2b6cb0]">
            <Users className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Total Learners</span>
            <span className="text-xl font-bold text-[#1a202c]">{totalLearners}</span>
          </div>
        </div>

        {/* Completion Rate */}
        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#c6f6d5] bg-[#f0fff4]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#2f855a]">
            <Activity className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Completion Rate</span>
            <span className="text-xl font-bold text-[#1a202c]">{completionRate}%</span>
          </div>
        </div>

        {/* Average Score */}
        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#fed7d7] bg-[#fff5f5]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#c53030]">
            <Award className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Average Score</span>
            <span className="text-xl font-bold text-[#1a202c]">{averageScore}%</span>
          </div>
        </div>

        {/* Duration */}
        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#fefcbf] bg-[#fffff0]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#d69e2e]">
            <Clock className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Estimated Duration</span>
            <span className="text-xl font-bold text-[#1a202c]">{course.duration || 0} mins</span>
          </div>
        </div>
      </div>

      {/* Staff / Certificates Section */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
        {/* Tabs */}
        <div className="mb-6 flex gap-6 border-b border-[#E2E8F0]">
          <button
            className={cn(
              'cursor-pointer border-b-2 py-3 text-sm font-semibold',
              activeTab === 'staff'
                ? 'border-primary text-[#2D3748]'
                : 'border-transparent text-[#718096]',
            )}
            onClick={() => setActiveTab('staff')}
          >
            Enrolled Staff
          </button>
          <button
            className={cn(
              'cursor-pointer border-b-2 py-3 text-sm font-semibold',
              activeTab === 'certificates'
                ? 'border-primary text-[#2D3748]'
                : 'border-transparent text-[#718096]',
            )}
            onClick={() => setActiveTab('certificates')}
          >
            Certificates Issued
          </button>
        </div>

        {activeTab === 'staff' ? (
          <>
            {/* Search + Export bar */}
            <div className="mb-4 flex items-center gap-3">
              <Input
                className="h-11 w-full sm:w-[280px]"
                placeholder="Search for staff..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                startIcon={<Search aria-hidden="true" />}
              />
              <Button variant="outline">
                <Download className="size-4" />
                Export
              </Button>
            </div>

            {/* Enrolled Staff Table */}
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0">
                  <TableHead style={{ width: '40%' }}>Staff Name</TableHead>
                  <TableHead style={{ width: '20%' }} className="hidden sm:table-cell">
                    Score
                  </TableHead>
                  <TableHead style={{ width: '20%' }} className="hidden md:table-cell">
                    Status
                  </TableHead>
                  <TableHead style={{ width: '20%' }} className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEnrollments.map((enrollment) => (
                  <TableRow key={enrollment.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#1a202c] text-sm font-semibold text-white">
                          {(
                            enrollment.user?.profile?.fullName?.[0] ||
                            enrollment.user?.email?.[0] ||
                            '?'
                          ).toUpperCase()}
                        </div>
                        <div>
                          <span className="block font-semibold text-[#1a202c]">
                            {enrollment.user?.profile?.fullName || enrollment.user?.email}
                          </span>
                          <span className="text-xs text-[#718096]">
                            {enrollment.user?.role || 'Staff'}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="font-bold text-[#2d3748]">
                        {enrollment.score !== null ? `${enrollment.score}%` : '-'}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {(enrollment.status === 'completed' || enrollment.status === 'attested') &&
                      (enrollment.score ?? 0) >= 70 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[#f0fff4] text-[#2f855a]">
                          <Check className="size-3" />
                          Passed
                        </span>
                      ) : enrollment.status === 'completed' || enrollment.status === 'attested' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[#fff5f5] text-[#c53030]">
                          <X className="size-3" />
                          Failed
                        </span>
                      ) : enrollment.status === 'lessons_complete' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-warning/10 text-warning">
                          <Clock className="size-3" />
                          Awaiting Quiz
                        </span>
                      ) : enrollment.status === 'in_progress' || enrollment.progress > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-warning/10 text-warning">
                          <Clock className="size-3" />
                          In Progress
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-muted text-muted-foreground">
                          Not Started
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-2">
                        {/* Quick View Result link */}
                        {enrollment.score !== null ? (
                          <Link
                            href={`/dashboard/training/courses/${course.id}/results/${enrollment.id}`}
                            className="text-sm font-semibold text-[#3182ce] hover:underline"
                          >
                            View Result
                          </Link>
                        ) : (
                          <span className="cursor-not-allowed text-sm text-[#cbd5e0]">
                            View Result
                          </span>
                        )}

                        {/* Kebab menu */}
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'View Result',
                              icon: <ClipboardList className="size-4" />,
                              disabled: enrollment.score === null,
                              onSelect: () =>
                                router.push(
                                  `/dashboard/training/courses/${course.id}/results/${enrollment.id}`,
                                ),
                            },
                            {
                              label: 'Assign Retake',
                              icon: <RotateCcw className="size-4" />,
                              separatorBefore: true,
                              onSelect: () =>
                                setRetakeEnrollment({
                                  id: enrollment.id,
                                  courseName: course.title,
                                }),
                            },
                          ]}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredEnrollments.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="text-center text-slate-500 p-6">
                      No staff enrolled yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        ) : (
          /* Certificates Tab */
          <div className="space-y-4">
            {enrollments.filter((e) => e.certificate).length === 0 ? (
              <div className="text-center text-slate-500 p-6">
                No certificates have been issued for this course yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-0">
                    <TableHead style={{ width: '40%' }}>Staff Name</TableHead>
                    <TableHead style={{ width: '30%' }} className="hidden sm:table-cell">
                      Issue Date
                    </TableHead>
                    <TableHead style={{ width: '30%' }} className="text-right">
                      Certificate
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments
                    .filter((e) => e.certificate)
                    .map((enrollment) => (
                      <TableRow key={enrollment.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#1a202c] text-sm font-semibold text-white">
                              {(
                                enrollment.user?.profile?.fullName?.[0] ||
                                enrollment.user?.email?.[0] ||
                                '?'
                              ).toUpperCase()}
                            </div>
                            <div>
                              <span className="block font-semibold text-[#1a202c]">
                                {enrollment.user?.profile?.fullName || enrollment.user?.email}
                              </span>
                              <span className="text-xs text-[#718096]">
                                {enrollment.user?.role || 'Staff'}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {new Date(enrollment.certificate!.issuedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedCertId(enrollment.certificate!.id)}
                          >
                            View Certificate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <ShareCourseModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        courseId={course.id}
      />

      {selectedCertId && (
        <CertificateModal
          isOpen={true}
          onClose={() => setSelectedCertId(null)}
          certificateId={selectedCertId}
        />
      )}

      <AssignRetakeModal
        isOpen={!!retakeEnrollment}
        onClose={() => setRetakeEnrollment(null)}
        enrollmentId={retakeEnrollment?.id || ''}
        courseName={retakeEnrollment?.courseName || ''}
        userName=""
      />
    </div>
  );
}
