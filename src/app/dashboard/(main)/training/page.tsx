import React from 'react';
import { getCourses, getDashboardStats } from '@/app/actions/course';
import TrainingClient from './TrainingClient';

// Ensure the page is dynamic so it fetches fresh data
export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
    // Fetch data in parallel
    const [courses, stats] = await Promise.all([
        getCourses(),
        getDashboardStats(),
    ]);

    return <TrainingClient courses={courses} stats={stats} />;
}
