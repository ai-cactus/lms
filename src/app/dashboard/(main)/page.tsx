import React from 'react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import DashboardCharts from '@/components/dashboard/DashboardCharts';
import MyCoursesTable from '@/components/dashboard/MyCoursesTable';
import { getDashboardData } from '@/app/actions/course';
import DashboardEmptyState from '@/components/dashboard/DashboardEmptyState';
import DashboardCreateCourseButton from '@/components/dashboard/DashboardCreateCourseButton';
import { BookOpen, Users, Activity } from 'lucide-react';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = session.user.role;
  if (role === 'worker') redirect('/worker');

  // Fetch billing status alongside dashboard data so the Create Course button
  // can apply the same billing gate as the Courses list page.
  const [{ courses, stats }, user] = await Promise.all([
    getDashboardData(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        organization: {
          select: { subscription: { select: { status: true } } },
        },
      },
    }),
  ]);

  const subStatus = user?.organization?.subscription?.status;
  const hasBilling = subStatus === 'active' || subStatus === 'trialing';

  // Calculate real metrics from courses data
  const totalCourses = stats?.totalCourses || 0;
  const totalStaffAssigned = stats?.totalStaffAssigned || 0;
  const averageGrade = stats?.averageGrade || 0;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-5 py-6 sm:px-8 xl:gap-8 xl:px-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 max-sm:flex-col">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-[#1a202c] xl:text-[28px]">Dashboard</h1>
          <p className="text-base text-[#718096]">Here is an overview of your courses</p>
        </div>
        <DashboardCreateCourseButton hasBilling={hasBilling} />
      </div>

      {/* Metrics Options */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        {/* Total Courses - Green */}
        <div className="flex min-h-[160px] flex-col justify-between rounded-2xl p-6 shadow-sm bg-[#ECFDF5]">
          <div>
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl text-white bg-[#10B981]">
              <BookOpen className="size-6" />
            </div>
            <p className="mb-1 text-sm font-semibold text-[#4a5568]">Total Courses</p>
          </div>
          <p className="text-[28px] font-bold text-[#1a202c] xl:text-4xl">{totalCourses}</p>
        </div>

        {/* Total Staff - Blue */}
        <div className="flex min-h-[160px] flex-col justify-between rounded-2xl p-6 shadow-sm bg-[#EEF2FF]">
          <div>
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl text-white bg-[#4730F7]">
              <Users className="size-6" />
            </div>
            <p className="mb-1 text-sm font-semibold text-[#4a5568]">Total Staff Assigned</p>
          </div>
          <p className="text-[28px] font-bold text-[#1a202c] xl:text-4xl">{totalStaffAssigned}</p>
        </div>

        {/* Average Grade - Red */}
        <div className="flex min-h-[160px] flex-col justify-between rounded-2xl p-6 shadow-sm bg-[#FEF2F2]">
          <div>
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl text-white bg-[#EF4444]">
              <Activity className="size-6" />
            </div>
            <p className="mb-1 text-sm font-semibold text-[#4a5568]">Average Grade</p>
          </div>
          <p className="text-[28px] font-bold text-[#1a202c] xl:text-4xl">{averageGrade}%</p>
        </div>
      </div>

      {/* Charts */}
      <DashboardCharts stats={stats} />

      {/* My Courses Table */}
      <MyCoursesTable courses={courses} maxItems={5} />

      {/* Empty State Modal */}
      <DashboardEmptyState totalCourses={totalCourses} />
    </div>
  );
}
