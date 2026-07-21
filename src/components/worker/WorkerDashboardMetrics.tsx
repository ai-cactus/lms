import React from 'react';
import { GraduationCap, CheckCircle2, BarChart3 } from 'lucide-react';

interface WorkerDashboardMetricsProps {
  totalCourses: number;
  completedCourses: number;
  averageGrade: number;
}

export default function WorkerDashboardMetrics({
  totalCourses,
  completedCourses,
  averageGrade,
}: WorkerDashboardMetricsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <div className="flex min-h-40 flex-col justify-between rounded-2xl bg-[#ECFDF5] p-6 shadow-sm max-[480px]:min-h-30 max-[480px]:p-4">
        <div>
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[#10B981] text-white max-[480px]:size-10 max-[480px]:rounded-[10px]">
            <GraduationCap className="size-6" aria-hidden="true" />
          </div>
          <p className="mb-1 text-sm font-semibold text-[#4a5568]">Total Courses</p>
        </div>
        <p className="text-[32px] font-bold text-[#1a202c] max-[480px]:text-2xl">{totalCourses}</p>
      </div>

      <div className="flex min-h-40 flex-col justify-between rounded-2xl bg-[#EEF2FF] p-6 shadow-sm max-[480px]:min-h-30 max-[480px]:p-4">
        <div>
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[#4730F7] text-white max-[480px]:size-10 max-[480px]:rounded-[10px]">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </div>
          <p className="mb-1 text-sm font-semibold text-[#4a5568]">Courses Completed</p>
        </div>
        <p className="text-[32px] font-bold text-[#1a202c] max-[480px]:text-2xl">
          {completedCourses}
        </p>
      </div>

      <div className="flex min-h-40 flex-col justify-between rounded-2xl bg-[#FEF2F2] p-6 shadow-sm max-[480px]:min-h-30 max-[480px]:p-4">
        <div>
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[#EF4444] text-white max-[480px]:size-10 max-[480px]:rounded-[10px]">
            <BarChart3 className="size-6" aria-hidden="true" />
          </div>
          <p className="mb-1 text-sm font-semibold text-[#4a5568]">Average Grade</p>
        </div>
        <p className="text-[32px] font-bold text-[#1a202c] max-[480px]:text-2xl">{averageGrade}%</p>
      </div>
    </div>
  );
}
