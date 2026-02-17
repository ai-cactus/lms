
import React from 'react';
import { getCourseById } from '@/app/actions/course';
import CoursePreview from '@/components/dashboard/training/CoursePreview';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function WorkerCourseDetailsPage(props: PageProps) {
    const params = await props.params;
    const course = await getCourseById(params.id);
    
    // We could also fetch enrollment status here if we wanted "Continue" logic more robustly
    // But CoursePreview just links to /learn/[id] which handles state restoration.
    
    return <CoursePreview course={course} mode="worker" />;
}
