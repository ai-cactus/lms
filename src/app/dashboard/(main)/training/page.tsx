import React from 'react';
import { getDashboardData } from '@/app/actions/course';
import { requirePermissionWithFacilityScope } from '@/lib/rbac/require-permission';
import TrainingClient from './TrainingClient';

// Ensure the page is dynamic so it fetches fresh data
export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  // Was unguarded: any authenticated session — Finance, a worker with a typed
  // URL — reached the roster-wide training figures. `course.read` is the same
  // gate the Courses list uses, and taking it through the facility variant means
  // the page cannot obtain the verb without also obtaining its scope.
  //
  // Q26: denial is `notFound`, not a redirect — a bounce to /dashboard is itself
  // evidence that the Training module exists.
  const { dataFacilityIds } = await requirePermissionWithFacilityScope('course.read', undefined, {
    onDeny: 'notFound',
  });

  const { courses, stats } = await getDashboardData(dataFacilityIds);

  return <TrainingClient courses={courses} stats={stats} />;
}
