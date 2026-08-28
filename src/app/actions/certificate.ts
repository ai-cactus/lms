'use server';

import prisma from '@/lib/prisma';
import { dbRoleToRoleKey, isAdminRole } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { resolveDataFacilityIds, staffFacilityWhere } from '@/lib/facility/staff-where';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { uploadFile } from '@/lib/storage';
import { generateCertificatePDF } from '@/lib/certificate-generator';
import { formatCertificateId } from '@/lib/certificate-id';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';
import type { Certificate } from '@/generated/prisma/client';

async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

/**
 * Outcome of {@link issueCertificate}. A refusal is returned rather than thrown
 * because Next.js redacts Server Action errors in production, which would show
 * the learner React error #441 instead of what they need to do. A discriminated
 * result is used here rather than the `refusedReason` field the assign actions
 * carry, because the success value is a Certificate row with no room for one.
 */
export type IssueCertificateResult =
  { ok: true; certificate: Certificate } | { ok: false; reason: string };

export async function issueCertificate(enrollmentId: string): Promise<IssueCertificateResult> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      organizationUser: { include: { user: true, organization: true } },
      course: true,
      certificate: true,
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  // Ensure the caller is authorized (either the enrolled learner, or their admin)
  const isWorker = enrollment.organizationUserId === session.user.organizationUserId;
  const isAdmin =
    isAdminRole(session.user.role) &&
    enrollment.organizationUser.organizationId === session.user.organizationId;

  if (!isWorker && !isAdmin) {
    throw new Error('Unauthorized');
  }

  // Refused by return: fail-closed, no certificate row, PDF or upload has been
  // produced at this point.
  if (enrollment.status !== 'completed' && enrollment.status !== 'attested') {
    logger.warn({
      msg: '[enrollment] Certificate issuance refused — course not completed',
      enrollmentId,
      status: enrollment.status,
    });
    return { ok: false, reason: 'Course must be completed to issue a certificate' };
  }

  // If already issued, return existing
  if (enrollment.certificate) {
    return { ok: true, certificate: enrollment.certificate };
  }

  // A certificate PDF is immutable once generated, so it must carry the
  // recipient's real name — never fall back to their email address. Block
  // issuance until the profile has a full name set.
  const fullName = enrollment.organizationUser.user.fullName?.trim();
  if (!fullName) {
    logger.warn({
      msg: '[enrollment] Certificate issuance blocked — recipient has no profile name',
      enrollmentId,
      organizationUserId: enrollment.organizationUserId,
    });
    return {
      ok: false,
      reason: 'Set your full name in your profile before earning a certificate.',
    };
  }

  const issueDate = new Date();
  const pdfBuffer = await generateCertificatePDF({
    studentName: fullName,
    courseName: enrollment.course.title,
    issueDate: issueDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    organizationName: enrollment.organizationUser.organization?.name,
    certificateId: formatCertificateId(enrollmentId),
  });

  const fileName = `certificates/${enrollment.id}-${Date.now()}.pdf`;
  const uploadResult = await uploadFile(fileName, pdfBuffer, 'application/pdf');

  const certificate = await prisma.certificate.create({
    data: {
      enrollmentId: enrollment.id,
      organizationUserId: enrollment.organizationUserId,
      courseId: enrollment.courseId,
      score: enrollment.score ?? 100,
      pdfStoragePath: uploadResult.storageUri,
      pdfGeneratedAt: new Date(),
      issuedAt: issueDate,
    },
  });

  // F-001: record certificate issuance on the authorized, successful path.
  await audit({
    action: 'certificate.issue',
    actorId: session.user.id,
    actorRole: session.user.role,
    organizationId: enrollment.organizationUser.organizationId,
    targetType: 'certificate',
    targetId: certificate.id,
    metadata: { enrollmentId, courseId: enrollment.courseId },
    ...getClientContext(await headers()),
  });

  revalidatePath('/dashboard/training');
  revalidatePath('/worker/certificates');

  return { ok: true, certificate };
}

export async function getWorkerCertificates() {
  const session = await workerAuth();
  if (!session?.user?.id || !session.user.organizationUserId) {
    throw new Error('Unauthorized');
  }

  const certificates = await prisma.certificate.findMany({
    where: { organizationUserId: session.user.organizationUserId },
    include: {
      course: { select: { title: true } },
    },
    orderBy: { issuedAt: 'desc' },
  });

  return certificates;
}

export async function getAdminWorkerCertificates(organizationUserId: string) {
  const session = await adminAuth();
  if (!session?.user?.id || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  // This is the certificate half of the staff profile, so it must reach the same
  // verdict as `getStaffDetails` — otherwise a target the profile 404s on still
  // yields its full training history through this id-addressed action. `user.read`
  // rather than `isAdminRole`, which admits Finance and Clinical Director.
  const roleKey = dbRoleToRoleKey(session.user.role);
  if (!roleKey || !can(roleKey, 'user.read')) {
    logger.warn({
      msg: '[certificate] Admin certificate read denied',
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Unauthorized');
  }

  // null for org-wide roles; an array (possibly empty) for a facility-bound one.
  const dataFacilityIds = await resolveDataFacilityIds(session);

  const certificates = await prisma.certificate.findMany({
    where: {
      // Scoped by the caller's org so a membership id from another tenant
      // simply resolves to nothing. The facility predicate composes into the
      // same query for the same reason: an out-of-facility target must come
      // back empty exactly as an unknown id does.
      organizationUserId,
      organizationUser: {
        organizationId: session.user.organizationId,
        ...staffFacilityWhere(dataFacilityIds),
      },
    },
    include: {
      course: { select: { title: true } },
    },
    orderBy: { issuedAt: 'desc' },
  });

  return certificates;
}

export async function getCertificateDetails(certificateId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const certificate = await prisma.certificate.findUnique({
    where: { id: certificateId },
    include: {
      organizationUser: { include: { user: true, organization: true } },
      course: true,
    },
  });

  if (!certificate) {
    throw new Error('Certificate not found');
  }

  const isWorker = certificate.organizationUserId === session.user.organizationUserId;
  const isAdmin =
    isAdminRole(session.user.role) &&
    certificate.organizationUser.organizationId === session.user.organizationId;

  if (!isWorker && !isAdmin) {
    throw new Error('Unauthorized');
  }

  return certificate;
}
