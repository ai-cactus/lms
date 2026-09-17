'use client';

import React, { useState, useTransition } from 'react';
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
import { removeWorkerAssignment } from '@/app/actions/enrollment';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  RotateCcw,
  UserMinus,
  ArrowLeft,
  CheckCircle2,
  Clock,
  UserPlus,
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
import { Alert } from '@/components/ui/alert';
import EmptyTableState from '@/components/ui/EmptyTableState';
import RoleTargetPicker, {
  type RoleTargetPickerMode,
} from '@/components/dashboard/enrollment/RoleTargetPicker';
import { courseStatusBadge } from '@/lib/course/course-status-label';
import { courseSourceDocument } from '@/lib/course/source-document';
import { CourseWithRelations } from '@/types/course';
import type { CourseAssignmentSettings } from '@/app/actions/enrollment';
import type { UserRole } from '@/generated/prisma/enums';

interface TrainingDetailsProps {
  course: CourseWithRelations;
  /**
   * Whether this viewer may withdraw an assignment. Computed on the server to
   * mirror removeWorkerAssignment's own gate, so the action is never offered
   * where it would be refused.
   */
  canWithdrawAssignments?: boolean;
  /**
   * Where "Go Back" leads. Computed on the server from the viewer's own
   * permissions: this page has no `course.read` gate but the courses list does,
   * so a role without it (finance, since 2026-08-25) was sent to a route that
   * redirected straight back and read as a dead button.
   */
  backHref?: string;
  /**
   * The org's saved assignment settings for this course, when the viewer holds
   * `assignment.read`. Null both when there is no assignment and when the
   * viewer may not read one — the two are indistinguishable here by design.
   */
  assignmentSettings?: CourseAssignmentSettings | null;
  /** Current headcount per role, so the picker can preview the enrolment reach. */
  roleHolderCounts?: Record<string, number>;
  /** The viewer holds `assignment.create`, so roles may be added. */
  canCreateRoleTargets?: boolean;
  /** The viewer holds `assignment.delete`, so roles may be revoked (D6). */
  canRevokeRoleTargets?: boolean;
}

const headCls =
  'h-10 px-2 text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] md:px-[18px] md:text-[15.5px]';
const cellCls = 'h-[71px] px-5 text-[17.5px] font-medium tracking-[0.35px] text-[#0d0d12]';
const tagCls =
  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[14px] font-medium whitespace-nowrap lg:text-[16.5px]';

export default function TrainingDetails({
  course,
  canWithdrawAssignments = false,
  backHref = '/dashboard',
  assignmentSettings = null,
  roleHolderCounts = {},
  canCreateRoleTargets = false,
  canRevokeRoleTargets = false,
}: TrainingDetailsProps) {
  const router = useRouter();
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; name: string } | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [isWithdrawing, startWithdraw] = useTransition();

  const confirmWithdraw = () => {
    if (!withdrawTarget) return;
    const { id } = withdrawTarget;
    setWithdrawTarget(null);
    setWithdrawError(null);

    startWithdraw(async () => {
      const result = await removeWorkerAssignment(id);
      if (result.success) {
        router.refresh();
      } else {
        // The action RETURNS its refusals, so the specific reason survives
        // production error redaction and can be shown verbatim.
        setWithdrawError(result.error ?? 'Could not withdraw that assignment.');
      }
    });
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'staff' | 'certificates'>('staff');
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  const [retakeEnrollment, setRetakeEnrollment] = useState<{
    id: string;
    courseName: string;
  } | null>(null);

  const [targetRoles, setTargetRoles] = useState<UserRole[]>(assignmentSettings?.targetRoles ?? []);
  const [roleTargetError, setRoleTargetError] = useState<string | null>(null);

  const enrollments = course.enrollments || [];

  const statusBadge = courseStatusBadge(course.status, course.reviewRequired);
  const sourceDocument = courseSourceDocument(course.versions);

  /**
   * Live mode only. A draft-mode picker would collect a selection this page has
   * no submit action to persist, so role targets are only editable here once the
   * assignment row already carries some — creating the first one stays with the
   * assign wizard, which records the assigner's own facility scope.
   */
  const pickerMode: RoleTargetPickerMode | null = assignmentSettings
    ? {
        kind: 'live',
        assignmentId: assignmentSettings.assignmentId,
        enrolledCount: assignmentSettings.enrolledCount,
        canCreate: canCreateRoleTargets,
        canRevoke: canRevokeRoleTargets,
      }
    : null;
  const showRoleTargets = Boolean(pickerMode) && (assignmentSettings?.targetRoles.length ?? 0) > 0;

  // A committed change re-targets the assignment server-side, so the roster and
  // enrolled count below are already stale by the time it returns.
  const handleRoleTargetsChange = (roles: UserRole[]) => {
    setTargetRoles(roles);
    setRoleTargetError(null);
    router.refresh();
  };

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
          href={backHref}
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

      <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <h1 className="text-[26px] leading-[1.2] font-bold tracking-[-0.02em] text-foreground sm:text-[32px]">
            {course.title}
          </h1>
          <Badge
            variant="outline"
            className={cn('rounded-full px-3 py-1 text-sm font-medium', statusBadge.className)}
          >
            {statusBadge.label}
          </Badge>
          {sourceDocument && (
            <p className="text-sm text-text-secondary">
              Linked Policy Document:{' '}
              <Link
                href={`/dashboard/documents/${sourceDocument.id}`}
                className="font-medium text-primary hover:underline"
              >
                {sourceDocument.name}
              </Link>
            </p>
          )}
        </div>

        {/*
          D7 moved to /preview with the hero: the details page's primary action
          now OPENS that preview, which is where "View Course" lives. Keeping a
          second entry point into the player here would put two competing calls
          to action on one screen.
        */}
        <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:shrink-0 lg:justify-end">
          <Button
            asChild
            className="h-12 min-w-[132px] flex-1 rounded-md px-6 text-[15.5px] font-semibold tracking-[-0.31px] lg:flex-none"
          >
            <Link href={`/dashboard/training/courses/${course.id}/preview`}>Preview</Link>
          </Button>
          <Button
            variant="outline"
            className="h-12 min-w-[132px] flex-1 gap-2 rounded-md px-5 text-[16px] font-semibold lg:flex-none has-[>svg]:px-5"
            onClick={() => router.push(`/dashboard/training/courses/${course.id}/assign`)}
          >
            <UserPlus className="size-5" aria-hidden="true" />
            Assign
          </Button>
        </div>
      </header>

      {showRoleTargets && pickerMode && (
        <div className="mb-5 rounded-[17px] border border-border bg-background p-6">
          <h3 className="text-lg font-bold text-foreground">Assigned roles</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Everyone holding these roles is enrolled automatically, including staff who take the
            role later.
          </p>

          {roleTargetError && (
            <Alert variant="error" className="mt-4">
              {roleTargetError}
            </Alert>
          )}

          <div className="mt-4">
            <RoleTargetPicker
              selectedRoles={targetRoles}
              onSelectionChange={handleRoleTargetsChange}
              mode={pickerMode}
              roleHolderCounts={roleHolderCounts}
              onLiveUpdateError={setRoleTargetError}
            />
          </div>
        </div>
      )}

      <div className="mb-5 rounded-[17px] bg-white px-2.5 py-[21px] shadow-[0px_1px_1px_0px_rgba(228,229,231,0.24)] sm:px-2.5">
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
              {/*
                Design label. The value beneath it is `course.duration` — the
                per-course ESTIMATE the AI produced at generation, not a measured
                average: nothing in the schema records time-on-task, and the only
                learner timestamps (`startedAt`/`completedAt`) fence assignment
                to completion, i.e. calendar days, not minutes of study.
              */}
              <span className="text-[14.5px] leading-none font-medium tracking-[-0.145px] text-[#6f767e]">
                Average Duration
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

        {withdrawError && (
          <Alert variant="error" className="mt-4">
            {withdrawError}
          </Alert>
        )}
        {isWithdrawing && (
          <p className="mt-4 text-sm text-text-secondary" role="status">
            Withdrawing assignment…
          </p>
        )}

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
                  <TableHead className={cn(headCls, 'rounded-l-[9px] sm:w-[41%] xl:w-[34%]')}>
                    Staff Name
                  </TableHead>
                  {/*
                    Held back to `xl`: the dashboard's 280px sidebar makes `lg`
                    narrower than a bare `md` viewport, so five columns only fit
                    from `xl` up.
                  */}
                  <TableHead className={cn(headCls, 'hidden xl:table-cell xl:w-[20%]')}>
                    Facility
                  </TableHead>
                  <TableHead className={cn(headCls, 'hidden sm:table-cell sm:w-[20%] xl:w-[13%]')}>
                    Score
                  </TableHead>
                  <TableHead className={cn(headCls, 'hidden md:table-cell md:w-[19%] xl:w-[18%]')}>
                    Status
                  </TableHead>
                  <TableHead
                    className={cn(headCls, 'w-[56px] rounded-r-[9px] sm:w-[20%] xl:w-[15%]')}
                  >
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
                    {/*
                      The facility recorded ON the enrollment, not the member's
                      current assignments — a transfer must not rewrite who was
                      enrolled where. Null for a member with no active facility.
                    */}
                    <TableCell className={cn(cellCls, 'hidden truncate xl:table-cell')}>
                      {enrollment.facility?.name ?? '-'}
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
                            // Offered only to the course creator, matching the
                            // action's gate — see canWithdrawAssignments.
                            ...(canWithdrawAssignments
                              ? [
                                  {
                                    label: 'Withdraw assignment',
                                    icon: <UserMinus className="size-4" />,
                                    variant: 'destructive' as const,
                                    onSelect: () =>
                                      setWithdrawTarget({
                                        id: enrollment.id,
                                        name:
                                          enrollment.organizationUser?.user?.fullName ||
                                          enrollment.organizationUser?.user?.email ||
                                          'this staff member',
                                      }),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredEnrollments.length === 0 && (
                  <EmptyTableState message="No staff enrolled yet." colSpan={5} asTableRow />
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

      <AlertDialog
        open={!!withdrawTarget}
        onOpenChange={(open) => !open && setWithdrawTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              {withdrawTarget?.name} will be removed from &ldquo;{course.title}&rdquo; and will lose
              access to it immediately, including any video already in progress. Their completion
              history for this course is removed with it, so this cannot be undone — assign the
              course again to restore access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep assignment</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmWithdraw}
              className="bg-error text-white hover:bg-error/90"
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
