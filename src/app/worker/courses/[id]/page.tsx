
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import CoursePreview from '@/components/dashboard/training/CoursePreview';
import { getCourseById } from '@/app/actions/course';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function WorkerCourseDetailsPage(props: PageProps) {
    const params = await props.params;
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/');
    }

    const course = await getCourseById(params.id);

    // Fetch enrollment for this user and course
    const enrollment = await prisma.enrollment.findUnique({
        where: {
            userId_courseId: {
                userId: session.user.id,
                courseId: params.id
            }
        },
        include: {
            user: {
                include: { profile: true }
            }
        }
    });

    // Sanitize course data to avoid leaking other users' enrollments to the client
    const sanitizedCourse = {
        ...course,
        enrollments: [] // Remove enrollments containing other users' data
    };

    return (
        <CoursePreview
            course={sanitizedCourse}
            mode="worker"
            user={session.user}
            enrollment={enrollment}
        />
    );
}
