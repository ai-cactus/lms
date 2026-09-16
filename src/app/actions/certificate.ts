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

  // The learner earning their own certificate always passes, and must stay
  // AHEAD of everything below: a worker holds no `certificate.create` verb, and
  // one with no active facility assignment narrows to `[]`. Either check would
  // lock them out of the certificate they just earned. Same self-access-first
  // shape as the three certificate reads.
  const isSelf = enrollment.organizationUserId === session.user.organizationUserId;

  if (!isSelf) {
    // Administrative issuance. BOTH halves of the verb gate are load-bearing.
    //
    //   can(roleKey, 'certificate.create') — the updated matrix moves
    //   Certificates to `CR`, and this is that `C`: generating the artifact is
    //   the create (founder Q1's reading on Audits). It also fences out Finance,
    //   which `isAdminRole` admits but which founder Q7 removed from
    //   certificates entirely — the reason this action needed a verb at all.
    //
    //   isAdminRole — load-bearing HERE, exactly as in `getCertificateDetails`
    //   and unlike the admin-fenced `getAdminWorkerCertificates`. This action
    //   takes the module's `resolveSession()`, which falls back to the WORKER
    //   instance, so a nurse's session really does reach this line.
    const roleKey = dbRoleToRoleKey(session.user.role);
    if (
      !roleKey ||
      !isAdminRole(session.user.role) ||
      !can(roleKey, 'certificate.create') ||
      !session.user.organizationId
    ) {
      logger.warn({
        msg: '[certificate] Certificate issuance denied',
        userId: session.user.id,
        role: session.user.role,
        enrollmentId,
      });
      throw new Error('Unauthorized');
    }

    // null for org-wide roles; an array (possibly empty) for a facility-bound one.
    const dataFacilityIds = await resolveDataFacilityIds(session);

    // Re-read the enrollment through the org + facility predicate rather than
    // comparing in JS, so this reaches the same verdict as the certificate
    // reads: a holder outside the caller's facilities is refused exactly as an
    // out-of-tenant one is. Q7's scope answer limits a Facility Supervisor to
    // their own facility's staff, and issuing for a learner they cannot even
    // read would contradict it.
    const inScope = await prisma.enrollment.findFirst({
      where: {
        id: enrollmentId,
        organizationUser: {
          organizationId: session.user.organizationId,
          ...staffFacilityWhere(dataFacilityIds),
        },
      },
      select: { id: true },
    });

    if (!inScope) {
      logger.warn({
        msg: '[certificate] Out-of-scope certificate issuance blocked',
        userId: session.user.id,
        role: session.user.role,
        enrollmentId,
      });
      throw new Error('Unauthorized');
    }
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

  // One rule across all three certificate surfaces: this, `getCertificateDetails`
  // and the download route in `api/certificates/[id]`.
  //
  // Here the verb is the load-bearing half. This function takes `adminAuth()`
  // directly, not the module's `resolveSession()`, and the admin instance fences
  // worker roles out at decode (`auth.ts:6` + `create-auth-instance.ts:736`), so
  // `isAdminRole` is defence in depth. It is load-bearing in
  // `getCertificateDetails`, which accepts either instance.
  //
  // This gate used to ask for `user.read`, which reads as "the staff-profile
  // verb" but denies Clinical Director — founder Q7: "All Clinical/Quality to
  // see certificates. For Clinical/Quality directors to see certificates, they
  // need access to all staff. Finance should not be able to see certificates."
  // Certificates are a Clinical/Quality concern and Staff Management is not, so
  // the certificate verb decides certificate reads. Q7's "access to all staff"
  // needs nothing here: `clinical_director` is already in
  // ORG_WIDE_FACILITY_ROLES, so `resolveDataFacilityIds` hands it `null`.
  const roleKey = dbRoleToRoleKey(session.user.role);
  if (!roleKey || !isAdminRole(session.user.role) || !can(roleKey, 'certificate.read')) {
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

  // The owning learner always reads their own certificate. This branch must stay
  // ahead of the facility narrowing below: a worker with no active facility
  // assignment resolves to `[]`, which would otherwise hide their own record.
  if (certificate.organizationUserId === session.user.organizationUserId) {
    return certificate;
  }

  // Administrative read. BOTH halves are load-bearing; neither works alone.
  //
  //   can(roleKey, 'certificate.read') — because `isAdminRole` alone admits
  //   Finance, which Phase 1 removed the certificate verb from. It is also why
  //   this is not `user.read`: Clinical Director has no Staff Management access
  //   but does hold the certificate verb (founder Q7).
  //
  //   isAdminRole — genuinely load-bearing HERE, unlike the two admin-fenced
  //   certificate gates. This action takes `resolveSession()`, which falls back
  //   to the WORKER instance, so a nurse's session really does reach this line.
  //   All eight worker roles hold `certificate.read` (granted by
  //   `workerPermissions` so a learner can read their own), and the verb alone
  //   does not separate "my certificate" from "theirs" — on an id-addressed
  //   action it would hand a nurse any colleague's name, course, score and email.
  //
  // Together: owner, admin, supervisor, hr, clinical_director — exactly Q7.
  const roleKey = dbRoleToRoleKey(session.user.role);
  if (
    !roleKey ||
    !isAdminRole(session.user.role) ||
    !can(roleKey, 'certificate.read') ||
    !session.user.organizationId
  ) {
    logger.warn({
      msg: '[certificate] Certificate detail read denied',
      userId: session.user.id,
      role: session.user.role,
      certificateId,
    });
    throw new Error('Unauthorized');
  }

  // null for org-wide roles; an array (possibly empty) for a facility-bound one.
  const dataFacilityIds = await resolveDataFacilityIds(session);

  // Re-read through the org + facility predicate rather than comparing in JS, so
  // this reaches the same verdict as `getAdminWorkerCertificates`: an
  // out-of-facility or out-of-tenant certificate is refused exactly as an
  // unknown id is.
  const inScope = await prisma.certificate.findFirst({
    where: {
      id: certificateId,
      organizationUser: {
        organizationId: session.user.organizationId,
        ...staffFacilityWhere(dataFacilityIds),
      },
    },
    select: { id: true },
  });

  if (!inScope) {
    logger.warn({
      msg: '[certificate] Out-of-scope certificate detail read blocked',
      userId: session.user.id,
      role: session.user.role,
      certificateId,
    });
    throw new Error('Unauthorized');
  }

  return certificate;
}
