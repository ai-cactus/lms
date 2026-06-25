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
import EmptyTableState from '@/components/ui/EmptyTableState';
import Link from 'next/link';
import Image from 'next/image';
import EditStaffModal from './EditStaffModal';
import { UserRole } from '@/generated/prisma/enums';
import AssignUserCourseModal from './AssignUserCourseModal';
import AssignRetakeModal from '../training/AssignRetakeModal';
import RemoveStaffModal from './RemoveStaffModal';
import QuizResults from '@/components/dashboard/training/QuizResults';
import { getEnrollmentQuizResult } from '@/app/actions/staff';
import { getAdminWorkerCertificates } from '@/app/actions/certificate';
import CertificateCardList from '../training/CertificateCardList';

type WorkerCertificate = Awaited<ReturnType<typeof getAdminWorkerCertificates>>[number];
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  User,
  X,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Lock,
  Check,
  RotateCcw,
  Search,
} from 'lucide-react';

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
      courseType?: string;
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
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'courses' | 'certificates'>('courses');
  const [certificates, setCertificates] = useState<WorkerCertificate[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(false);

  React.useEffect(() => {
    if (activeTab === 'certificates' && certificates.length === 0) {
      setLoadingCerts(true);
      getAdminWorkerCertificates(user.id)
        .then((res) => {
          setCertificates(res);
          setLoadingCerts(false);
        })
        .catch((err) => {
          logger.error({ msg: 'Failed to fetch certificates', err });
          setLoadingCerts(false);
        });
    }
  }, [activeTab, user.id, certificates.length]);

  const handleViewResult = async (enrollmentId: string) => {
    setLoadingEnrollmentId(enrollmentId);
    try {
      const result = await getEnrollmentQuizResult(enrollmentId);
      if (result) {
        setViewingResult({ ...result, enrollmentId });
      }
    } catch (err) {
      logger.error({ msg: 'Error loading result', err });
    } finally {
      setLoadingEnrollmentId(null);
    }
  };

  // Filter enrollments
  const filteredEnrollments = enrollments.filter((e) =>
    e.courseName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      {/* Breadcrumb */}
      <Link
        href="/dashboard/staff"
        className="mb-6 inline-flex items-center gap-2 text-sm text-[#718096] hover:text-[#4a5568]"
      >
        <ArrowLeft className="size-4" />
        Go Back
        <span className="text-[#cbd5e0]">/</span>
        Staff Details
        <span className="text-[#cbd5e0]">/</span>
        <span className="font-medium text-primary">Staff Profile</span>
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 max-md:flex-col">
        <div className="flex gap-6">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1a202c] text-white">
            {user.avatarUrl ? (
              <Image
                src={user.avatarUrl}
                alt={user.name}
                width={80}
                height={80}
                className="size-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[28px] font-semibold">
                {(user.name.charAt(0) || 'U').toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center">
            <h1 className="mb-1 text-2xl font-bold text-[#1a202c]">{user.name}</h1>
            <div className="mb-3 flex items-center gap-2 text-sm text-[#718096]">
              <User className="size-3.5" />
              {user.email}
            </div>
            <div className="inline-block w-fit rounded bg-[#e6fffa] px-3 py-1 text-xs font-semibold text-[#2c7a7b]">
              {user.jobTitle || 'Direct Support Professional (DSP)'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <Button variant="outline" onClick={() => setIsEditModalOpen(true)}>
            Edit Profile
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowRemoveModal(true)}
            className="border-red-600 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Remove Staff
          </Button>
          <Button onClick={() => setIsAssignModalOpen(true)}>Assign Course</Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#bee3f8] bg-[#ebf8ff]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#2b6cb0]">
            <BookOpen className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Total Courses Assigned</span>
            <span className="text-xl font-bold text-[#1a202c]">{stats.totalCourses}</span>
          </div>
        </div>

        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#c6f6d5] bg-[#f0fff4]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#2f855a]">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Courses Completed</span>
            <span className="text-xl font-bold text-[#1a202c]">{stats.completedCourses}</span>
          </div>
        </div>

        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#fed7d7] bg-[#fff5f5]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#c53030]">
            <AlertTriangle className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Failed / Retake Needed</span>
            <span className="text-xl font-bold text-[#1a202c]">{stats.failedCourses}</span>
          </div>
        </div>

        <div className="flex min-h-20 items-center gap-4 rounded-xl border p-5 border-[#fefcbf] bg-[#fffff0]">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white bg-[#d69e2e]">
            <Clock className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-[13px] text-[#4a5568]">Active / Due Soon</span>
            <span className="text-xl font-bold text-[#1a202c]">{stats.activeCourses}</span>
          </div>
        </div>
      </div>

      {/* Courses & Certificates */}
      <div className="mt-6 rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex gap-6 border-b border-[#E2E8F0] mb-6">
          <button
            onClick={() => setActiveTab('courses')}
            className={cn(
              'cursor-pointer border-b-2 py-3 text-sm font-semibold',
              activeTab === 'courses'
                ? 'border-primary text-[#2D3748]'
                : 'border-transparent text-[#718096]',
            )}
          >
            Courses
          </button>
          <button
            onClick={() => setActiveTab('certificates')}
            className={cn(
              'cursor-pointer border-b-2 py-3 text-sm font-semibold',
              activeTab === 'certificates'
                ? 'border-primary text-[#2D3748]'
                : 'border-transparent text-[#718096]',
            )}
          >
            Certificates Issued
          </button>
        </div>

        {activeTab === 'courses' ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Input
                  className="h-11 w-full sm:w-[250px]"
                  placeholder="Search for courses..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  startIcon={<Search aria-hidden="true" />}
                />
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0 ">
                  <TableHead style={{ width: '40%' }}>Name</TableHead>
                  <TableHead style={{ width: '30%' }} className="hidden md:table-cell">
                    Progress
                  </TableHead>
                  <TableHead style={{ width: '15%' }} className="hidden sm:table-cell">
                    Quiz Status
                  </TableHead>
                  <TableHead style={{ width: '15%' }}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEnrollments.map((enrollment) => (
                  <TableRow key={enrollment.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#2d3748] text-white">
                          <BookOpen className="size-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#1a202c]">
                              {enrollment.courseName}
                            </span>
                          </div>
                          <span className="text-xs text-[#718096]">
                            {enrollment.difficulty || 'Advanced'}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex w-full max-w-[200px] items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#edf2f7]">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${enrollment.progress || 0}%` }}
                          ></div>
                        </div>
                        <span className="w-8 text-xs text-[#718096]">
                          {enrollment.progress || 0}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {(enrollment.status === 'completed' || enrollment.progress === 100) &&
                      enrollment.score >= (enrollment.passingScore || 70) ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[#f0fff4] text-[#2f855a]">
                          <Check className="size-3" />
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
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[#fff5f5] text-[#c53030]"
                            style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}
                          >
                            <Lock className="size-3" />
                            Locked
                          </span>
                          <span style={{ fontSize: '10px', color: '#E53E3E' }}>Limit reached</span>
                        </div>
                      ) : enrollment.status === 'completed' || enrollment.progress === 100 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[#fff5f5] text-[#c53030]">
                          <X className="size-3" />
                          Failed
                        </span>
                      ) : (
                        <div
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                        >
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
                    </TableCell>
                    <TableCell style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        {enrollment.status === 'locked' && (
                          <Button
                            size="sm"
                            onClick={() =>
                              setRetakeEnrollment({
                                id: enrollment.id,
                                courseName: enrollment.courseName,
                              })
                            }
                          >
                            <RotateCcw className="size-3.5" />
                            Retake
                          </Button>
                        )}
                        {(enrollment.status === 'completed' ||
                          enrollment.progress === 100 ||
                          (enrollment.quizAttempts && enrollment.quizAttempts.length > 0)) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewResult(enrollment.id)}
                            disabled={loadingEnrollmentId === enrollment.id}
                            loading={loadingEnrollmentId === enrollment.id}
                          >
                            View
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredEnrollments.length === 0 && (
                  <EmptyTableState
                    message="No courses found."
                    subMessage="This staff member has no enrolled courses."
                    colSpan={4}
                    asTableRow
                  />
                )}
              </TableBody>
            </Table>
          </>
        ) : (
          <div>
            {loadingCerts ? (
              <div className="py-12 text-center text-[#718096]">Loading certificates...</div>
            ) : (
              <CertificateCardList
                certificates={certificates}
                title=""
                description=""
                showExport={false}
              />
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <EditStaffModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        staff={{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as UserRole,
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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setViewingResult(null)}
        >
          <div
            className="relative max-h-[90vh] w-[90%] max-w-[800px] overflow-y-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewingResult(null)}
              className="absolute right-3 top-3"
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

      <RemoveStaffModal
        isOpen={showRemoveModal}
        onClose={() => setShowRemoveModal(false)}
        staffId={user.id}
        staffName={user.name}
        staffEmail={user.email}
      />
    </div>
  );
}
