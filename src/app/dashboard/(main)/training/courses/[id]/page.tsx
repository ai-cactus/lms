import React from 'react';
import { getCourseById } from '@/app/actions/course';
import TrainingDetails from '@/components/dashboard/training/TrainingDetails';

export const dynamic = 'force-dynamic';

// Next.js 15+: params is a Promise
interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function CourseDetailsPage(props: PageProps) {
    const params = await props.params;
    const course = await getCourseById(params.id);
    return <TrainingDetails course={course} />;
}
