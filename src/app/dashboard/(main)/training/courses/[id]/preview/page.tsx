import React from 'react';
import { getCourseById } from '@/app/actions/course';
import CoursePreview from '@/components/dashboard/training/CoursePreview';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function CoursePreviewPage(props: PageProps) {
    const params = await props.params;
    const course = await getCourseById(params.id);
    return <CoursePreview course={course} />;
}
