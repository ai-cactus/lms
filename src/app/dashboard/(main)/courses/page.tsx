import React from 'react';
import { getCourses } from '@/app/actions/course';
import CoursesListClient from '@/components/dashboard/courses/CoursesListClient';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
    const courses = await getCourses();
    return <CoursesListClient courses={courses} />;
}
