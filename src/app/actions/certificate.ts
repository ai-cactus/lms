'use server';

import prisma from '@/lib/prisma';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { uploadFile } from '@/lib/storage';
import { generateCertificatePDF } from '@/lib/certificate-generator';
import { formatCertificateId } from '@/lib/certificate-id';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';

async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

export async function issueCertificate(enrollmentId: string) {
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

  if (enrollment.status !== 'completed' && enrollment.status !== 'attested') {
    throw new Error('Course must be completed to issue a certificate');
  }

  // If already issued, return existing
  if (enrollment.certificate) {
    return enrollment.certificate;
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
    throw new Error('Set your full name in your profile before earning a certificate.');
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

  return certificate;
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
  if (!session?.user?.id || !isAdminRole(session.user.role) || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  const certificates = await prisma.certificate.findMany({
    where: {
      // Scoped by the caller's org so a membership id from another tenant
      // simply resolves to nothing.
      organizationUserId,
      organizationUser: { organizationId: session.user.organizationId },
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
