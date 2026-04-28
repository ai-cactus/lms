'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { uploadFile } from '@/lib/storage';
import { generateCertificatePDF } from '@/lib/certificate-generator';

async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

export async function issueCertificate(enrollmentId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Verify enrollment and completion
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { include: { profile: true, organization: true } },
      course: true,
      certificate: true,
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  // Ensure user is authorized (either the user themselves, or their admin)
  const isWorker = enrollment.userId === session.user.id;
  const isAdmin =
    session.user.role === 'admin' && enrollment.user.organizationId === session.user.organizationId;

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

  // Generate PDF
  const issueDate = new Date();
  const pdfBuffer = await generateCertificatePDF({
    studentName: enrollment.user.profile?.fullName || enrollment.user.email,
    courseName: enrollment.course.title,
    issueDate: issueDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    organizationName: enrollment.user.organization?.name,
    certificateId: `CERT-${enrollmentId.substring(0, 8).toUpperCase()}`,
  });

  // Upload to storage
  const fileName = `certificates/${enrollment.id}-${Date.now()}.pdf`;
  const uploadResult = await uploadFile(fileName, pdfBuffer, 'application/pdf');

  // Save to DB
  const certificate = await prisma.certificate.create({
    data: {
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      courseId: enrollment.courseId,
      score: enrollment.score || 100,
      pdfStoragePath: uploadResult.storageUri,
      pdfGeneratedAt: new Date(),
      issuedAt: issueDate,
    },
  });

  revalidatePath('/dashboard/training');
  revalidatePath('/worker/certificates');

  return certificate;
}

export async function getWorkerCertificates() {
  const session = await workerAuth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const certificates = await prisma.certificate.findMany({
    where: { userId: session.user.id },
    include: {
      course: { select: { title: true } },
    },
    orderBy: { issuedAt: 'desc' },
  });

  return certificates;
}
