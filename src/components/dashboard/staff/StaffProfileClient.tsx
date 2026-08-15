'use client';

import React, { useEffect, useState } from 'react';
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
import EmptyTableState from '@/components/ui/EmptyTableState';
import { RowActionsMenu } from '@/components/ui';
import Link from 'next/link';
import Image from 'next/image';
import AssignCoursesModal from './AssignCoursesModal';
import ChangeFacilityModal from './ChangeFacilityModal';
import type { AccessibleFacility } from '@/lib/facility/scope';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
import AssignRetakeModal from '../training/AssignRetakeModal';
import CertificateModal from '../training/CertificateModal';
import QuizResults from '@/components/dashboard/training/QuizResults';
import { getEnrollmentQuizResult } from '@/app/actions/staff';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import { getAdminWorkerCertificates } from '@/app/actions/certificate';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Building2,
  User,
  X,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Lock,
  Check,
  BadgeCheck,
  Award,
  RotateCcw,
  Plus,
  Search,
} from 'lucide-react';

type WorkerCertificate = Awaited<ReturnType<typeof getAdminWorkerCertificates>>[number];

interface StaffProfileClientProps {
  staff: {
    user: {
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      role: string;
      jobTitle: string;
      facilityName: string | null;
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
      courseType?: string;
      progress: number;
      status: string;
      score: number;
      passingScore: number;
      difficulty?: string;
      dueAt: string | null;
      quizAttempts?: {
        id: string;
        attemptCount: number;
        timeTaken: number | null;
      }[];
      allowedAttempts?: number;
    }[];
  };
  viewerRole: Role;
  facilities: AccessibleFacility[];
}

const headCls = 'h-10 px-[18px] text-[15.5px] font-medium tracking-[0.31px] text-[#666d80]';
const cellCls = 'h-[71px] px-5 text-[17.5px] font-medium tracking-[0.35px] text-[#0d0d12]';
const statusPillCls =
  'inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap';
const cardCls =
  'flex min-w-0 flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:px-[21px] md:pt-[21px] md:pb-4';
const cardTitleCls =
  'text-base leading-[1.5] font-semibold tracking-[0.4px] text-[#0d0d12] md:text-xl';
const searchInputCls =
  'h-9 rounded-[8.5px] border-[#dfe1e6] pl-9 text-[15px] shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] placeholder:text-[#a4abb8]';
const rowLinkCls = 'h-auto p-0 text-[15.5px] font-medium';

/**
 * Mirrors `AT_RISK_WINDOW_DAYS` in `src/lib/reminders/status-tracker.ts` — a
 * deadline flagged red here is the same one the Status Tracker calls "at risk".
 * Duplicated rather than imported because that module pulls in Prisma.
 */
const DUE_SOON_WINDOW_DAYS = 7;

/**
 * Pins a fixed timeZone so the server (UTC) and the browser (local) render the
 * same string — otherwise React reports a hydration mismatch (#418).
 */
function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function isDueUrgent(dueAt: string): boolean {
  const msUntilDue = new Date(dueAt).getTime() - Date.now();
  return msUntilDue <= DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

const STAT_CARDS = [
  {
    key: 'totalCourses',
    label: 'Total Courses Assigned',
    icon: BookOpen,
    card: 'border-[#9ba7e3] bg-[#e9ecf9]',
    badge: 'bg-[#162ea3]',
  },
  {
    key: 'completedCourses',
    label: 'Courses Completed',
    icon: CheckCircle2,
    card: 'border-[#9be3c2] bg-[#e9f9f2]',
    badge: 'bg-[#16a34a]',
  },
  {
    key: 'failedCourses',
    label: 'Failed / Retake Needed',
    icon: AlertTriangle,
    card: 'border-[#e39b9b] bg-[#f9e9e9]',
    badge: 'bg-[#cd1515]',
  },
  {
    key: 'activeCourses',
    label: 'Active / Due Soon',
    icon: Clock,
    card: 'border-[#e3cf9b] bg-[#fffad5]',
    badge: 'bg-[#db8e00]',
  },
] as const;

export default function StaffProfileClient({
  staff,
  viewerRole,
  facilities,
}: StaffProfileClientProps) {
  // NOTE: `user.id` here is the OrganizationUser (membership) id, not the global
  // identity id — getStaffDetails maps orgUser.id onto this field. Everything
  // downstream of it is membership-scoped.
  const { user, stats, enrollments } = staff;

  // Moving a member between facilities is a roster mutation, so it stays on
  // `user.edit`. Assigning courses is an assignment write and follows the gate
  // `assignCoursesToUser` enforces — a Clinical Director may assign training
  // without holding any roster-edit rights. Both only hide dead-end UI; the
  // server actions are authoritative.
  const canEdit = can(dbRoleToRoleKey(viewerRole), 'user.edit');
  const canAssignCourses = can(dbRoleToRoleKey(viewerRole), 'assignment.create');

  const [searchQuery, setSearchQuery] = useState('');
  const [certificateSearchQuery, setCertificateSearchQuery] = useState('');
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isChangeFacilityOpen, setIsChangeFacilityOpen] = useState(false);
  const canChangeFacility = canEdit && facilities.length > 0 && user.role !== 'owner';
  const [retakeEnrollment, setRetakeEnrollment] = useState<{
    id: string;
    courseName: string;
  } | null>(null);
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
    organizationName?: string;
  } | null>(null);
  const [loadingEnrollmentId, setLoadingEnrollmentId] = useState<string | null>(null);
  const [certificates, setCertificates] = useState<WorkerCertificate[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(true);
  const [viewingCertificateId, setViewingCertificateId] = useState<string | null>(null);

  useEffect(() => {
    setLoadingCerts(true);
    getAdminWorkerCertificates(user.id)
      .then((res) => {
        setCertificates(res);
        setLoadingCerts(false);
      })
      .catch((err) => {
        logger.error({ msg: '[staff] Failed to fetch certificates', err });
        setLoadingCerts(false);
      });
  }, [user.id]);

  const handleViewResult = async (enrollmentId: string) => {
    setLoadingEnrollmentId(enrollmentId);
    try {
      const result = await getEnrollmentQuizResult(enrollmentId);
      if (result) {
        setViewingResult({ ...result, enrollmentId });
      }
    } catch (err) {
      logger.error({ msg: '[staff] Error loading result', err });
    } finally {
      setLoadingEnrollmentId(null);
    }
  };

  const filteredEnrollments = enrollments.filter((e) =>
    e.courseName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredCertificates = certificates.filter((c) =>
    c.course.title.toLowerCase().includes(certificateSearchQuery.toLowerCase()),
  );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[30px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Link
          href="/dashboard/staff"
          className="inline-flex items-center gap-3 font-medium text-[#667185] transition-colors hover:text-[#0d0d12]"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-[#e4e7ec] bg-white">
            <ArrowLeft className="size-3.5 text-[#1e2635]" aria-hidden="true" />
          </span>
          Go Back
        </Link>
        <nav aria-label="Breadcrumb" className="flex items-center gap-2">
          <Link
            href="/dashboard/staff"
            className="font-medium text-[#667185] transition-colors hover:text-[#0d0d12]"
          >
            Staff Details
          </Link>
          <span aria-hidden="true" className="text-[#98a2b3]">
            /
          </span>
          <span aria-current="page" className="font-medium text-primary">
            Staff Profile
          </span>
        </nav>
      </div>

      <div className="flex flex-col gap-9 rounded-[17px] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:p-[21px]">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-[26px]">
          <div className="flex size-[110px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1a202c] text-white md:size-[141px]">
            {user.avatarUrl ? (
              <Image
                src={user.avatarUrl}
                alt=""
                width={141}
                height={141}
                className="size-full object-cover"
              />
            ) : (
              <span className="text-[40px] font-semibold md:text-[48px]">
                {(user.name.charAt(0) || 'U').toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-6 lg:flex-row lg:items-center lg:gap-8">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.56px] text-[#101928] md:text-[28px]">
                {user.name}
              </h1>
              <div className="flex items-center gap-2.5 text-[14px] leading-5 text-[#475467]">
                <User className="size-[19px] shrink-0" aria-hidden="true" />
                <span className="truncate">{user.email}</span>
              </div>
              <span className="w-fit rounded-[6px] bg-[#eafdf5] px-[12.4px] py-[5px] text-[12.4px] leading-[20.667px] font-semibold text-[#59904b]">
                {[getRoleDisplayName(user.role as Role) || user.jobTitle, user.facilityName]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>

            {(canAssignCourses || canChangeFacility) && (
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {canChangeFacility && (
                  <Button
                    variant="outline"
                    onClick={() => setIsChangeFacilityOpen(true)}
                    className="h-12 gap-2 rounded-[12px] px-6 text-[15.5px] font-semibold tracking-[-0.31px]"
                  >
                    <Building2 className="size-5" />
                    Change Facility
                  </Button>
                )}
                {canAssignCourses && (
                  <Button
                    onClick={() => setIsAssignModalOpen(true)}
                    className="h-12 gap-2 rounded-[12px] px-6 text-[15.5px] font-semibold tracking-[-0.31px]"
                  >
                    <Plus className="size-[25px]" />
                    Assign Course
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-7">
          {STAT_CARDS.map(({ key, label, icon: Icon, card, badge }) => (
            <div
              key={key}
              className={cn(
                'flex h-[81px] items-center gap-4 rounded-[12.5px] border px-[19px] py-3',
                card,
              )}
            >
              <span
                className={cn(
                  'flex size-[35px] shrink-0 items-center justify-center rounded-[9px] text-white',
                  badge,
                )}
              >
                <Icon className="size-[17.5px]" aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-col gap-[7px]">
                <span className="text-[13.5px] leading-[14.4px] font-medium tracking-[-0.13px] text-[#6f767e]">
                  {label}
                </span>
                <span className="text-[21px] leading-none font-bold text-[#262626]">
                  {stats[key]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <section className={cardCls} aria-labelledby="trainings-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="trainings-heading" className={cardTitleCls}>
            Trainings
          </h2>
          <div className="w-full sm:w-1/2 sm:max-w-[506px]">
            <Input
              placeholder="Search for courses..."
              className={searchInputCls}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search courses"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
        </div>

        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead
                className={cn(headCls, 'w-full rounded-l-[9px] px-3 md:w-[30%] md:px-[18px]')}
              >
                Name
              </TableHead>
              <TableHead className={cn(headCls, 'hidden md:table-cell md:w-[21%]')}>
                Progress
              </TableHead>
              <TableHead className={cn(headCls, 'hidden lg:table-cell lg:w-[21%]')}>
                Deadline
              </TableHead>
              <TableHead className={cn(headCls, 'hidden sm:table-cell sm:w-[160px] md:w-[13%]')}>
                Status
              </TableHead>
              <TableHead
                className={cn(
                  headCls,
                  'w-[92px] rounded-r-[9px] px-3 text-right md:w-[15%] md:px-5',
                )}
              >
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEnrollments.map((enrollment) => {
              const progress = enrollment.progress || 0;
              const isAttested = enrollment.status === 'attested';
              const isComplete =
                enrollment.status === 'completed' || isAttested || progress === 100;
              const hasPassed = isComplete && enrollment.score >= (enrollment.passingScore || 70);
              const isLocked = enrollment.status === 'locked';
              const attempt = enrollment.quizAttempts?.[0];
              const hasResult =
                isComplete || (enrollment.quizAttempts && enrollment.quizAttempts.length > 0);
              // A finished course can't slip its deadline any more, so it keeps
              // the plain date even when that date has passed.
              const showDueChip =
                !isComplete && !!enrollment.dueAt && isDueUrgent(enrollment.dueAt);

              const isLoadingResult = loadingEnrollmentId === enrollment.id;

              return (
                <TableRow
                  key={enrollment.id}
                  onClick={
                    hasResult && !isLoadingResult
                      ? () => handleViewResult(enrollment.id)
                      : undefined
                  }
                  aria-busy={isLoadingResult}
                  className={cn(hasResult && 'cursor-pointer')}
                >
                  <TableCell className={cn(cellCls, 'px-3 md:px-[18px]')}>
                    <div className="flex items-center gap-3 md:gap-[18px]">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
                        <Image
                          src="/images/icon-course-blue.svg"
                          alt=""
                          width={40}
                          height={40}
                          aria-hidden="true"
                          className="object-cover"
                        />
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[15.5px] font-semibold tracking-[0.35px] text-[#0d0d12] md:text-[17.5px]">
                          {enrollment.courseName}
                        </span>
                        <span className="truncate text-[13.5px] font-normal text-[#666d80]">
                          {enrollment.difficulty || 'Advanced'}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className={cn(cellCls, 'hidden md:table-cell')}>
                    <div className="flex w-full max-w-[172px] items-center gap-3">
                      <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-[#e5e7ea]">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="w-9 shrink-0 text-[14px] font-medium text-[#666d80]">
                        {progress}%
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className={cn(cellCls, 'hidden lg:table-cell')}>
                    {!enrollment.dueAt ? (
                      <span className="text-[#a4abb8]">&mdash;</span>
                    ) : showDueChip ? (
                      <span className={cn(statusPillCls, 'bg-[#fff1f1] text-[#d31616]')}>
                        <Clock className="size-4 shrink-0" aria-hidden="true" />
                        Due {formatDate(enrollment.dueAt)}
                      </span>
                    ) : (
                      <span className="text-[#525252]">{formatDate(enrollment.dueAt)}</span>
                    )}
                  </TableCell>

                  <TableCell className={cn(cellCls, 'hidden sm:table-cell')}>
                    {isAttested ? (
                      <span className={cn(statusPillCls, 'bg-[#eaf2fc] text-[#0e69f3]')}>
                        <BadgeCheck className="size-4 shrink-0" aria-hidden="true" />
                        Attested
                      </span>
                    ) : hasPassed ? (
                      <span className={cn(statusPillCls, 'bg-[#eafdf5] text-[#308242]')}>
                        <Check className="size-4 shrink-0" aria-hidden="true" />
                        Passed
                      </span>
                    ) : isLocked ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className={cn(statusPillCls, 'bg-[#fff1f1] text-[#e13737]')}>
                          <Lock className="size-4 shrink-0" aria-hidden="true" />
                          Locked
                        </span>
                        <span className="text-[11px] font-medium text-[#e13737]">
                          Limit reached
                        </span>
                      </div>
                    ) : isComplete ? (
                      <span className={cn(statusPillCls, 'bg-[#fff1f1] text-[#e13737]')}>
                        <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
                        Failed
                      </span>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <span className={cn(statusPillCls, 'bg-[#fffad1] text-[#d8651e]')}>
                          <Clock className="size-4 shrink-0" aria-hidden="true" />
                          In progress
                        </span>
                        {enrollment.quizAttempts && (
                          <span className="text-[11px] font-medium text-[#a0aec0]">
                            Attempt{' '}
                            {Math.min(
                              attempt
                                ? attempt.timeTaken === null
                                  ? attempt.attemptCount
                                  : attempt.attemptCount + 1
                                : 1,
                              enrollment.allowedAttempts || 99,
                            )}
                            {enrollment.allowedAttempts && ` of ${enrollment.allowedAttempts}`}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>

                  <TableCell
                    className={cn(cellCls, 'px-3 md:px-5')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-2 md:gap-3">
                      {isLocked && (
                        <Button
                          variant="link"
                          className={cn(rowLinkCls, 'text-[#d92d20] hover:text-[#d92d20]')}
                          onClick={() =>
                            setRetakeEnrollment({
                              id: enrollment.id,
                              courseName: enrollment.courseName,
                            })
                          }
                        >
                          Retry
                        </Button>
                      )}
                      <RowActionsMenu
                        className="size-8 text-[#7f838f]"
                        label={`Actions for ${enrollment.courseName}`}
                        actions={[
                          {
                            label: 'Assign Retake',
                            icon: <RotateCcw className="size-4" />,
                            // Retakes only exist for locked enrollments (quiz
                            // attempts exhausted) — assignRetake rejects any
                            // other status, so don't offer it.
                            disabled: !isLocked,
                            onSelect: () =>
                              setRetakeEnrollment({
                                id: enrollment.id,
                                courseName: enrollment.courseName,
                              }),
                          },
                        ]}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredEnrollments.length === 0 && (
              <EmptyTableState
                message="No courses found."
                subMessage="This staff member has no enrolled courses."
                colSpan={5}
                asTableRow
              />
            )}
          </TableBody>
        </Table>
      </section>

      <section className={cardCls} aria-labelledby="certificates-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="certificates-heading" className={cardTitleCls}>
            Certificates Earned
          </h2>
          <div className="w-full sm:w-1/2 sm:max-w-[506px]">
            <Input
              placeholder="Search for courses..."
              className={searchInputCls}
              value={certificateSearchQuery}
              onChange={(e) => setCertificateSearchQuery(e.target.value)}
              aria-label="Search certificates"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
        </div>

        {loadingCerts ? (
          <p className="py-12 text-center text-[15px] text-[#666d80]">Loading certificates...</p>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead
                  className={cn(
                    headCls,
                    'w-full rounded-l-[9px] rounded-r-[9px] px-3 sm:rounded-r-none md:w-[57%] md:px-[18px]',
                  )}
                >
                  Certificates/Courses
                </TableHead>
                <TableHead className={cn(headCls, 'hidden md:table-cell md:w-[27%]')}>
                  Completion Date
                </TableHead>
                <TableHead
                  className={cn(
                    headCls,
                    'hidden sm:table-cell sm:w-[160px] sm:rounded-r-[9px] md:w-[16%]',
                  )}
                >
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCertificates.map((certificate) => (
                <TableRow
                  key={certificate.id}
                  onClick={() => setViewingCertificateId(certificate.id)}
                  className="cursor-pointer"
                >
                  <TableCell className={cn(cellCls, 'px-3 md:px-[18px]')}>
                    <div className="flex items-center gap-3 md:gap-[18px]">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[#e4e7ec] bg-white text-[#e0a712]">
                        <Award className="size-[22px]" aria-hidden="true" />
                      </span>
                      <span className="truncate text-[15.5px] font-semibold tracking-[0.35px] text-[#0d0d12] md:text-[17.5px]">
                        {certificate.course.title}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className={cn(cellCls, 'hidden md:table-cell')}>
                    <span className="text-[#3e4558]">{formatDate(certificate.issuedAt)}</span>
                  </TableCell>

                  <TableCell className={cn(cellCls, 'hidden sm:table-cell')}>
                    <span className={cn(statusPillCls, 'bg-[#eaf2fc] text-[#0e69f3]')}>
                      <BadgeCheck className="size-4 shrink-0" aria-hidden="true" />
                      Approved
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {filteredCertificates.length === 0 && (
                <EmptyTableState
                  message="No certificates found."
                  subMessage="This staff member has not earned any certificates yet."
                  colSpan={3}
                  asTableRow
                />
              )}
            </TableBody>
          </Table>
        )}
      </section>

      <ChangeFacilityModal
        isOpen={isChangeFacilityOpen}
        onClose={() => setIsChangeFacilityOpen(false)}
        member={{
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          currentFacilityName: user.facilityName,
        }}
        facilities={facilities}
      />

      <AssignCoursesModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        staffOrgUserId={user.id}
        staffName={user.name}
      />

      <AssignRetakeModal
        isOpen={!!retakeEnrollment}
        onClose={() => setRetakeEnrollment(null)}
        enrollmentId={retakeEnrollment?.id || ''}
        courseName={retakeEnrollment?.courseName || ''}
        userName={user.name}
      />

      {viewingCertificateId && (
        <CertificateModal
          isOpen={true}
          onClose={() => setViewingCertificateId(null)}
          certificateId={viewingCertificateId}
        />
      )}

      {viewingResult && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setViewingResult(null)}
        >
          <div
            className="relative max-h-[90vh] w-[90%] max-w-[800px] overflow-y-auto rounded-[17px] bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewingResult(null)}
              className="absolute top-3 right-3"
              aria-label="Close quiz result"
            >
              <X className="size-4" />
            </Button>
            <QuizResults
              courseId=""
              enrollmentId={viewingResult.enrollmentId}
              data={viewingResult}
              hideActions={true}
              userRole="admin"
              organizationName={viewingResult.organizationName}
            />
          </div>
        </div>
      )}
    </div>
  );
}
