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
import CertificateModal from './CertificateModal';
import AssignRetakeModal from './AssignRetakeModal';
import {
  RotateCcw,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Calendar,
  Share2,
  XCircle,
  Search,
  Download,
  Users,
  Award,
  Activity,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { courseTypeLabel, courseTypeBadgeVariant } from '@/lib/video/course-type-label';
import { CourseWithRelations } from '@/types/course';

interface TrainingDetailsProps {
  course: CourseWithRelations;
}

const headCls =
  'h-10 px-2 text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] md:px-[18px] md:text-[15.5px]';
const cellCls = 'h-[71px] px-5 text-[17.5px] font-medium tracking-[0.35px] text-[#0d0d12]';
const tagCls =
  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[14px] font-medium whitespace-nowrap lg:text-[16.5px]';

export default function TrainingDetails({ course }: TrainingDetailsProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'staff' | 'certificates'>('staff');
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  const [retakeEnrollment, setRetakeEnrollment] = useState<{
    id: string;
    courseName: string;
  } | null>(null);

  const enrollments = course.enrollments || [];

  const totalLearners = enrollments.length;

  const completedCount = enrollments.filter((e) => e.status === 'completed').length;
  const completionRate = totalLearners > 0 ? Math.round((completedCount / totalLearners) * 100) : 0;

  const scoredEnrollments = enrollments.filter((e) => e.score !== null);
  const averageScore =
    scoredEnrollments.length > 0
      ? Math.round(
          scoredEnrollments.reduce((sum: number, e) => sum + (e.score || 0), 0) /
            scoredEnrollments.length,
        )
      : 0;

  const filteredEnrollments = enrollments.filter((e) => {
    const q = searchQuery.toLowerCase();
    const nameMatch = e.organizationUser?.user?.fullName?.toLowerCase().includes(q);
    const emailMatch = e.organizationUser?.user?.email.toLowerCase().includes(q);
    return nameMatch || emailMatch;
  });

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Link
          href="/dashboard/courses"
          className="inline-flex items-center gap-3 text-sm text-[#667185] transition-colors hover:text-[#101928]"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[4px] border border-[#e4e7ec] bg-white">
            <ArrowLeft className="size-3" aria-hidden="true" />
          </span>
          Go Back
        </Link>
        <p className="flex items-center gap-1 text-sm">
          <span className="text-[#0f1828]/50">Course</span>
          <span className="text-[#0f1828]/50">/</span>
          <span className="text-primary">Course Details</span>
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-9 rounded-[17px] bg-white px-2.5 py-[21px] shadow-[0px_1px_1px_0px_rgba(228,229,231,0.24)] sm:px-2.5">
        <div className="flex items-center gap-[31px] max-md:flex-col max-md:items-start max-md:gap-5">
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-[5px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] text-[#101928] sm:text-[28px]">
                {course.title}
              </h1>
              <Badge variant={courseTypeBadgeVariant(course.type)}>
                {courseTypeLabel(course.type)}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-[15px] bg-[#eafdf5] px-[14px] py-px text-[13px] leading-[22px] font-semibold text-[#59904b]">
                Active
              </span>
              {course.type !== 'video' && (
                <span className="inline-flex items-center gap-1.5 rounded-[15px] bg-[#eafdf5] px-[14px] py-px text-[13px] leading-[22px] font-semibold text-[#59904b]">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Approved by: Admin
                </span>
              )}
            </div>
            <p className="text-sm leading-5 text-[#475467]">
              Mandatory annual training aligned with organizational standards
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-[#475467]">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden="true" />
                {course.duration || 10} min read
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" aria-hidden="true" />
                Pass mark:{' '}
                {course.lessons?.find((l) => (l as { quiz?: { passingScore?: number } }).quiz)?.quiz
                  ?.passingScore || 80}
                %
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button
              asChild
              className="h-12 rounded-[12px] px-6 text-[15.5px] font-semibold tracking-[-0.31px]"
            >
              <Link href={`/dashboard/training/courses/${course.id}/preview`}>Preview</Link>
            </Button>
            <Button
              variant="outline"
              className="h-12 gap-2 rounded-[12px] border-[#d4d4d4] px-5 text-[16px] font-semibold text-primary has-[>svg]:px-5"
              onClick={() => router.push(`/dashboard/training/courses/${course.id}/assign`)}
            >
              <Share2 className="size-[23px]" aria-hidden="true" />
              Assign
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2">
          <div className="flex min-h-[120px] items-center gap-[18px] rounded-[12.5px] border-[0.9px] border-[#9ba7e3] bg-[#e9ecf9] px-[22px] py-[13px]">
            <span className="flex size-[45px] shrink-0 items-center justify-center rounded-[12px] bg-[#162ea3] text-white">
              <Users className="size-[22px]" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-[7px]">
              <span className="text-[14.5px] leading-none font-medium tracking-[-0.145px] text-[#6f767e]">
                Total Learners
              </span>
              <span className="text-[22px] leading-none font-bold text-[#262626]">
                {totalLearners}
              </span>
            </div>
          </div>

          <div className="flex min-h-[120px] items-center gap-[18px] rounded-[12.5px] border-[0.9px] border-[#9be3c2] bg-[#e9f9f2] px-[22px] py-[13px]">
            <span className="flex size-[45px] shrink-0 items-center justify-center rounded-[12px] bg-[#16a34a] text-white">
              <Activity className="size-[22px]" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-[7px]">
              <span className="text-[14.5px] leading-none font-medium tracking-[-0.145px] text-[#6f767e]">
                Completion Rate
              </span>
              <span className="text-[22px] leading-none font-bold text-[#262626]">
                {completionRate}%
              </span>
            </div>
          </div>

          <div className="flex min-h-[120px] items-center gap-[18px] rounded-[12.5px] border-[0.9px] border-[#e39b9b] bg-[#f9e9e9] px-[22px] py-[13px]">
            <span className="flex size-[45px] shrink-0 items-center justify-center rounded-[12px] bg-[#cd1515] text-white">
              <Award className="size-[22px]" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-[7px]">
              <span className="text-[14.5px] leading-none font-medium tracking-[-0.145px] text-[#6f767e]">
                Average Score
              </span>
              <span className="text-[22px] leading-none font-bold text-[#262626]">
                {averageScore}%
              </span>
            </div>
          </div>

          <div className="flex min-h-[120px] items-center gap-[18px] rounded-[12.5px] border-[0.9px] border-[#e3c99b] bg-[#fffad5] px-[22px] py-[13px]">
            <span className="flex size-[45px] shrink-0 items-center justify-center rounded-[12px] bg-[#db8e00] text-white">
              <Clock className="size-[22px]" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-[7px]">
              <span className="text-[14.5px] leading-none font-medium tracking-[-0.145px] text-[#6f767e]">
                Estimated Duration
              </span>
              <span className="text-[22px] leading-none font-bold text-[#262626]">
                {course.duration || 0} mins
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:px-[21px] md:pt-[21px] md:pb-4">
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
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-[470px]">
                <Input
                  className="h-[38px] rounded-[8.5px] border-[#dfe1e6] pl-9 text-[15px] shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] placeholder:text-[#a4abb8]"
                  placeholder="Search for staff..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search enrolled staff"
                  startIcon={<Search aria-hidden="true" />}
                />
              </div>
              <Button variant="outline" className="h-[38px] rounded-[8.5px] border-[#dfe1e6]">
                <Download className="size-4" />
                Export
              </Button>
            </div>

            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className={cn(headCls, 'rounded-l-[9px] sm:w-[41%]')}>
                    Staff Name
                  </TableHead>
                  <TableHead className={cn(headCls, 'hidden sm:table-cell sm:w-[20%]')}>
                    Score
                  </TableHead>
                  <TableHead className={cn(headCls, 'hidden md:table-cell md:w-[19%]')}>
                    Status
                  </TableHead>
                  <TableHead className={cn(headCls, 'w-[56px] rounded-r-[9px] sm:w-[20%]')}>
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEnrollments.map((enrollment) => (
                  <TableRow
                    key={enrollment.id}
                    onClick={
                      enrollment.score !== null
                        ? () =>
                            router.push(
                              `/dashboard/training/courses/${course.id}/results/${enrollment.id}`,
                            )
                        : undefined
                    }
                    className={cn(enrollment.score !== null && 'cursor-pointer')}
                  >
                    <TableCell className={cn(cellCls, 'px-2 md:px-[18px]')}>
                      <div className="flex items-center gap-3 sm:gap-[18px]">
                        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#1a202c] text-sm font-semibold text-white">
                          {(
                            enrollment.organizationUser?.user?.fullName?.[0] ||
                            enrollment.organizationUser?.user?.email?.[0] ||
                            '?'
                          ).toUpperCase()}
                        </div>
                        <div className="flex min-w-0 flex-col gap-[4.5px]">
                          <span className="truncate text-[15.5px] font-semibold tracking-[0.31px] text-[#0d0d12]">
                            {enrollment.organizationUser?.user?.fullName ||
                              enrollment.organizationUser?.user?.email}
                          </span>
                          <span className="truncate text-[13.5px] tracking-[0.27px] text-[#666d80]">
                            {enrollment.organizationUser?.role || 'Staff'}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn(cellCls, 'hidden sm:table-cell')}>
                      {enrollment.score !== null ? `${enrollment.score}%` : '-'}
                    </TableCell>
                    <TableCell className={cn(cellCls, 'hidden px-2 md:table-cell')}>
                      {(enrollment.status === 'completed' || enrollment.status === 'attested') &&
                      (enrollment.score ?? 0) >= 70 ? (
                        <span className={cn(tagCls, 'bg-[#e4fdf2] text-[#59904b]')}>
                          <CheckCircle2 className="size-[22px] shrink-0" aria-hidden="true" />
                          Passed
                        </span>
                      ) : enrollment.status === 'completed' || enrollment.status === 'attested' ? (
                        <span className={cn(tagCls, 'bg-[#fbe7e7] text-[#d53c3c]')}>
                          <XCircle className="size-[22px] shrink-0" aria-hidden="true" />
                          Failed
                        </span>
                      ) : enrollment.status === 'lessons_complete' ? (
                        <span className={cn(tagCls, 'bg-[#fff8bd] text-[#c18e09]')}>
                          <Clock className="size-[19px] shrink-0" aria-hidden="true" />
                          Awaiting Quiz
                        </span>
                      ) : enrollment.status === 'in_progress' || enrollment.progress > 0 ? (
                        <span className={cn(tagCls, 'bg-[#fff8bd] text-[#c18e09]')}>
                          <Clock className="size-[19px] shrink-0" aria-hidden="true" />
                          In Progress
                        </span>
                      ) : (
                        <span className={cn(tagCls, 'bg-muted text-muted-foreground')}>
                          Not Started
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(cellCls, 'px-1 md:px-[18px]')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1 md:gap-3">
                        <RowActionsMenu
                          className="size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4"
                          actions={[
                            {
                              label: 'Assign Retake',
                              icon: <RotateCcw className="size-4" />,
                              // Retakes only exist for locked enrollments (quiz
                              // attempts exhausted) — assignRetake rejects any
                              // other status, so don't offer it.
                              disabled: enrollment.status !== 'locked',
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
                  <EmptyTableState message="No staff enrolled yet." colSpan={4} asTableRow />
                )}
              </TableBody>
            </Table>
          </>
        ) : (
          <div className="space-y-4">
            {enrollments.filter((e) => e.certificate).length === 0 ? (
              <EmptyTableState message="No certificates have been issued for this course yet." />
            ) : (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className={cn(headCls, 'rounded-l-[9px] sm:w-[45%]')}>
                      Staff Name
                    </TableHead>
                    <TableHead className={cn(headCls, 'hidden sm:table-cell sm:w-[27%]')}>
                      Issue Date
                    </TableHead>
                    <TableHead className={cn(headCls, 'rounded-r-[9px] sm:w-[28%]')}>
                      Certificate
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments
                    .filter((e) => e.certificate)
                    .map((enrollment) => (
                      <TableRow key={enrollment.id}>
                        <TableCell className={cn(cellCls, 'px-2 md:px-[18px]')}>
                          <div className="flex items-center gap-3 sm:gap-[18px]">
                            <div className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#1a202c] text-sm font-semibold text-white">
                              {(
                                enrollment.organizationUser?.user?.fullName?.[0] ||
                                enrollment.organizationUser?.user?.email?.[0] ||
                                '?'
                              ).toUpperCase()}
                            </div>
                            <div className="flex min-w-0 flex-col gap-[4.5px]">
                              <span className="truncate text-[15.5px] font-semibold tracking-[0.31px] text-[#0d0d12]">
                                {enrollment.organizationUser?.user?.fullName ||
                                  enrollment.organizationUser?.user?.email}
                              </span>
                              <span className="truncate text-[13.5px] tracking-[0.27px] text-[#666d80]">
                                {enrollment.organizationUser?.role || 'Staff'}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className={cn(cellCls, 'hidden sm:table-cell')}>
                          {new Date(enrollment.certificate!.issuedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className={cn(cellCls, 'px-1 md:px-[18px]')}>
                          <Button
                            variant="outline"
                            className="h-10 rounded-[10px] border-[#dfe1e6] text-sm font-semibold"
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
