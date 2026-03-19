import React from 'react';
import { getDashboardData } from '@/app/actions/course';
import TrainingClient from './TrainingClient';

// Ensure the page is dynamic so it fetches fresh data
export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  // ⚡ Bolt: Fetch dashboard data in a single query to prevent redundant DB calls
  const { courses, stats } = await getDashboardData();

  return <TrainingClient courses={courses} stats={stats} />;
}
