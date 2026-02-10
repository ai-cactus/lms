import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function POST(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const enrollmentId = params.id;
        const body = await request.json();
        const { progress } = body;

        // Verify enrollment belongs to user
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId }
        });

        if (!enrollment || enrollment.userId !== session.user.id) {
            return NextResponse.json({ error: 'Enrollment not found' }, { status: 403 });
        }

        // Update progress
        await prisma.enrollment.update({
            where: { id: enrollmentId },
            data: {
                progress: Math.min(progress, 100),
                status: progress < 100 ? 'in_progress' : enrollment.status
            }
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Error updating progress:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
