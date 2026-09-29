import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { guardApiSession } from '@/lib/auth-guard';
import { hasActiveBilling } from '@/lib/billing';
import { touchEnrollmentActivity } from '@/lib/enrollment/activity';
import { statusAfterProgress } from '@/lib/enrollment/status-guards';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

const progressSchema = z.object({
  progress: z.number().min(0).max(100),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const workerSession = await workerAuth();
    const adminSession = await adminAuth();

    // F-012: enforce authentication + MFA step-up at the data-access layer.
    const denied = guardApiSession(workerSession ?? adminSession);
    if (denied) return denied;

    const enrollmentId = params.id;
    const body = await request.json();

    const parsedBody = progressSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid input data', details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { progress } = parsedBody.data;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        // Nested, so the archive query extension leaves it alone — an archived
        // course must still be readable here in order to be refused.
        course: { select: { archivedAt: true } },
        organizationUser: {
          select: {
            organization: {
              select: { subscription: { select: { status: true, pausedAt: true } } },
            },
          },
        },
      },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    if (
      enrollment.organizationUserId !== workerSession?.user?.organizationUserId &&
      enrollment.organizationUserId !== adminSession?.user?.organizationUserId
    ) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to active sessions' },
        { status: 403 },
      );
    }

    // Billing gate (defense in depth): the layout blocks the portal when the org
    // lacks active billing; this stops a direct POST from advancing progress.
    if (!hasActiveBilling(enrollment.organizationUser?.organization?.subscription)) {
      logger.warn({
        msg: '[enrollment] Progress update blocked — organization lacks active billing',
        enrollmentId,
      });
      return NextResponse.json(
        {
          error:
            'Your organization’s training access is paused. Please contact your administrator.',
        },
        { status: 403 },
      );
    }

    // Q-04: progress is the learner advancing through the course, which stops
    // at the archive.
    if (enrollment.course.archivedAt) {
      logger.warn({
        msg: '[enrollment] Progress update blocked — course is archived',
        enrollmentId,
        courseId: enrollment.courseId,
      });
      return NextResponse.json({ error: ARCHIVED_COURSE_LEARNER_MESSAGE }, { status: 403 });
    }

    const now = new Date();

    // Only allow forward progress (never decrease)
    const newProgress = Math.min(progress, 100);
    if (newProgress <= enrollment.progress) {
      // Revisiting earlier lessons is still engagement, even though progress holds.
      await touchEnrollmentActivity(prisma, enrollmentId, now);
      return NextResponse.json({ success: true, message: 'Progress already ahead' });
    }

    // BUG-53: progress is recorded on any status (it is a high-water mark of
    // what the learner has read), but it may only move the STATUS within the
    // reading phase — a locked, failed or signed-off enrolment keeps its status.
    const newStatus = statusAfterProgress(enrollment.status, newProgress);

    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        progress: newProgress,
        status: newStatus,
        lastActivityAt: now,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({ msg: 'Error updating progress:', err: err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
