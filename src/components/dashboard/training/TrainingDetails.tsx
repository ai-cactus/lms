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
  BarChart3,
  CheckCircle2,
  CircleCheck,
  Clock,
  Calendar,
  Eye,
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
import { Alert } from '@/components/ui/alert';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { RichTextContent } from '@/components/courses/RichTextContent';
import RoleTargetPicker, {
  type RoleTargetPickerMode,
} from '@/components/dashboard/enrollment/RoleTargetPicker';
import { courseTypeLabel } from '@/lib/video/course-type-label';
import { courseStatusBadge } from '@/lib/course/course-status-label';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
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

/** Chip treatment for the dark hero — the light-surface Badge variants vanish on it. */
const heroChipCls = 'gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium';
const heroNeutralChipCls = 'border-background/25 bg-background/10 text-background/85';

/** Label + value row in the right-hand rail (Skill Level / Duration / Last Updated). */
function RailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-text-secondary">
        <Icon className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        {label}
      </span>
      <span className="text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

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
  const lessons = course.lessons ?? [];
  const objectives = course.objectives ?? [];

  const statusBadge = courseStatusBadge(course.status, course.reviewRequired);
  // The shared helper's classes are tuned for a light card; on the dark hero its
  // `text-foreground` would be invisible, so only the LABEL is reused here.
  const heroStatusChipCls =
    course.status === 'published'
      ? 'border-success/40 bg-success/20 text-success'
      : course.reviewRequired
        ? 'border-warning/40 bg-warning/20 text-warning'
        : heroNeutralChipCls;

  // Video courses report "watch" time from the video length; text courses "read".
  const videoLesson = lessons.find((l) => l.videoStorageUri);
  const isVideoCourse = course.type === 'video' || Boolean(videoLesson);
  const videoSeconds = videoLesson?.videoDurationSeconds ?? null;
  const runtimeMinutes =
    videoSeconds != null && videoSeconds > 0
      ? Math.max(1, Math.round(videoSeconds / 60))
      : (course.duration ?? null);

  // Text courses hang the quiz off the last lesson; video courses off the course.
  const passingScore =
    lessons.find((l) => l.quiz)?.quiz?.passingScore ?? course.quiz?.passingScore ?? null;

  /**
   * D8/D10. `approvedBy` records who signed the publish off, but a null is a
   * permanent, reachable state — every course published before D8, plus any
   * clean draft that `publishCourseOnAssignment` publishes as a side effect of
   * being assigned. It falls back to the creator under a DIFFERENT label, so the
   * line never implies a review that did not happen.
   */
  const approver = course.approvedBy;
  const creator = course.creator;
  const attribution = approver
    ? {
        label: 'Approved by',
        name: approver.user.fullName || approver.user.email,
        role: getRoleDisplayName(approver.role),
      }
    : creator
      ? {
          label: 'Created by',
          name: creator.user.fullName || creator.user.email,
          role: getRoleDisplayName(creator.role),
        }
      : null;

  const overviewHtml = course.overview || course.description || '';
  const hasCourseContent = Boolean(overviewHtml) || objectives.length > 0;

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

      <section className="mb-5 flex flex-col gap-6 rounded-[17px] bg-foreground px-6 py-8 text-background md:px-9 md:py-10">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] leading-[1.2] font-bold tracking-[-0.02em] sm:text-[34px]">
              {course.title}
            </h1>
            <Badge variant="outline" className={cn(heroChipCls, heroNeutralChipCls)}>
              {courseTypeLabel(course.type)}
            </Badge>
          </div>

          {course.description && (
            <p className="max-w-3xl text-base leading-6 text-background/70">{course.description}</p>
          )}

          {attribution && (
            <p className="flex items-center gap-2 text-base font-semibold">
              <CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
              <span>
                {attribution.label}: {attribution.name} ({attribution.role})
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-5 border-t border-dashed border-background/25 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className={cn(heroChipCls, heroStatusChipCls)}>
              {statusBadge.label}
            </Badge>
            {runtimeMinutes != null && (
              <Badge variant="outline" className={cn(heroChipCls, heroNeutralChipCls)}>
                <Clock aria-hidden="true" />
                {runtimeMinutes} min {isVideoCourse ? 'watch' : 'read'}
              </Badge>
            )}
            {passingScore != null && (
              <Badge variant="outline" className={cn(heroChipCls, heroNeutralChipCls)}>
                <Calendar aria-hidden="true" />
                Pass mark: {passingScore}%
              </Badge>
            )}
          </div>

          {/*
            Three actions in descending emphasis, left to right. The frame shows
            only "View Course"; Preview is kept as a tertiary affordance because
            /preview has no other inbound link in the product and would otherwise
            be reachable by URL alone.
          */}
          <div className="flex w-full flex-wrap items-center gap-2.5 lg:w-auto lg:shrink-0 lg:justify-end">
            {/* D7: the details page's own call to action opens THIS course. */}
            <Button
              asChild
              className="h-12 min-w-[150px] flex-1 rounded-md px-6 text-[15.5px] font-semibold tracking-[-0.31px] lg:flex-none"
            >
              <Link href={`/learn/${course.id}`}>View Course</Link>
            </Button>
            <Button
              variant="outline"
              className="h-12 min-w-[132px] flex-1 gap-2 rounded-md border-background/30 bg-transparent px-5 text-[16px] font-semibold text-background hover:bg-background/10 hover:text-background lg:flex-none has-[>svg]:px-5"
              onClick={() => router.push(`/dashboard/training/courses/${course.id}/assign`)}
            >
              <Share2 className="size-[23px]" aria-hidden="true" />
              Assign
            </Button>
            {/* Reads as a text link on its own row below `lg`, inline at `lg`. */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="w-full justify-start px-0 font-medium text-background/80 hover:bg-background/10 hover:text-background lg:w-auto lg:px-3"
            >
              <Link href={`/dashboard/training/courses/${course.id}/preview`}>
                <Eye className="size-4" aria-hidden="true" />
                Preview
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {hasCourseContent || lessons.length > 0 ? (
        <div
          className={cn(
            'mb-5 grid grid-cols-1 gap-5',
            hasCourseContent && 'lg:grid-cols-[minmax(0,1fr)_340px]',
          )}
        >
          {hasCourseContent && (
            <div className="rounded-[17px] border border-border bg-background p-6 md:p-8">
              {overviewHtml && (
                <>
                  <h2 className="mb-4 text-2xl font-bold text-foreground">Course Overview</h2>
                  <RichTextContent html={overviewHtml} />
                </>
              )}

              {objectives.length > 0 && (
                <>
                  <h3
                    className={cn('mb-4 text-xl font-bold text-foreground', overviewHtml && 'mt-8')}
                  >
                    What You&apos;ll Learn
                  </h3>
                  <ul className="flex list-disc flex-col gap-2 pl-5 text-base leading-relaxed text-text-secondary">
                    {objectives.map((objective, index) => (
                      <li key={index}>{objective}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <aside className="rounded-[17px] border border-border bg-background p-6">
            <h3 className="text-lg font-bold text-foreground">Table of Content</h3>
            {lessons.length > 0 ? (
              // Deliberately unhighlighted: an overview page has no "current"
              // lesson, so the Figma frame's highlighted entry is placeholder.
              <ol className="mt-4 flex list-none flex-col gap-3">
                {lessons.map((lesson) => (
                  <li key={lesson.id} className="truncate text-base text-text-secondary">
                    {lesson.title}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-sm text-text-muted">No lessons have been generated yet.</p>
            )}

            <div className="mt-6 flex flex-col gap-4 border-t border-border pt-6 text-sm">
              {course.skillLevel && (
                <RailRow
                  icon={BarChart3}
                  label="Skill Level"
                  value={<span className="capitalize">{course.skillLevel}</span>}
                />
              )}
              {course.duration != null && (
                <RailRow icon={Clock} label="Duration" value={`${course.duration} mins`} />
              )}
              <RailRow
                icon={Calendar}
                label="Last Updated"
                value={new Date(course.updatedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              />
            </div>
          </aside>
        </div>
      ) : null}

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
