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

        const quizId = params.id;
        const body = await request.json();
        const { enrollmentId, answers } = body;

        if (!enrollmentId || !answers) {
            return NextResponse.json({ error: 'Missing data' }, { status: 400 });
        }

        // Check active attempt
        const attempt = await prisma.quizAttempt.findUnique({
            where: {
                enrollmentId_quizId: { enrollmentId, quizId }
            }
        });

        if (!attempt) {
            return NextResponse.json({ error: 'No attempt found' }, { status: 404 });
        }

        if (attempt.timeTaken !== null) {
            return NextResponse.json({ error: 'Attempt is already completed' }, { status: 409 });
        }

        // Update answers
        await prisma.quizAttempt.update({
            where: { id: attempt.id },
            data: {
                answers: answers // Replace answers JSON
            }
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Error saving quiz progress:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
