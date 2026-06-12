'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Image from 'next/image';

import TrainingDashboard, {
  DashboardStats,
} from '@/components/dashboard/training/TrainingDashboard';
import { CourseWithStats } from '@/types/course';

interface TrainingClientProps {
  stats: DashboardStats;
  courses: CourseWithStats[];
}

import { useRouter } from 'next/navigation';

// ... imports

export default function TrainingClient({ stats, courses }: TrainingClientProps) {
  const router = useRouter();
  // If user has courses, default to showing the dashboard.
  // Otherwise show the empty state / onboarding.
  const [showDashboard, setShowDashboard] = React.useState(courses.length > 0);

  const handleCreateCourse = () => {
    router.push('/dashboard/courses/create');
  };

  if (showDashboard) {
    return (
      <TrainingDashboard onCreateCourse={handleCreateCourse} stats={stats} courses={courses} />
    );
  }

  return (
    <div className="flex h-full items-start justify-center pt-5">
      <div className="relative w-full max-w-[1000px] rounded-[20px] bg-white p-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-5 right-5 z-10 rounded-full bg-[#f7fafc] text-[#a0aec0] hover:bg-[#edf2f7] hover:text-[#4a5568]"
          onClick={() => setShowDashboard(true)}
        >
          <X className="size-5" aria-hidden="true" />
        </Button>

        <div className="flex flex-col gap-10 p-6 md:flex-row md:p-10">
          {/* Left Column: Illustration & CTA */}
          <div className="flex flex-1 flex-col items-center rounded-2xl bg-[#d6f5eb] p-8 text-left">
            {/* ... (illustration code unchanged) ... */}
            <div className="mb-6 flex h-[260px] w-full items-center justify-center">
              <div className="relative flex items-center justify-center">
                <Image
                  src="/assets/training-illustration.svg"
                  alt="Training Center Illustration"
                  width={345}
                  height={257}
                  priority
                />
              </div>
            </div>

            <h2 className="mb-4 text-2xl leading-tight font-bold text-[#065f46]">
              Turn Your Healthcare Policies into Interactive Training in Minutes.
            </h2>

            <p className="mb-8 text-base leading-relaxed text-[#4b5563]">
              Operationalize your policies and procedures by training your staff
            </p>

            <Button
              size="lg"
              className="w-auto self-start border-[#047857] bg-[#047857] font-semibold hover:bg-[#065f46]"
              onClick={handleCreateCourse}
            >
              Create your first course
            </Button>
          </div>

          {/* Right Column: Steps */}
          <div className="flex flex-1 flex-col justify-center md:pl-5">
            <h3 className="mb-6 text-2xl font-bold text-[#111827]">How to get started</h3>

            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-bold text-[#111827]">1. Upload Policies</h4>
                <p className="text-[13px] leading-relaxed text-[#6b7280]">
                  Upload your organization&apos;s documents. Theraptly will analyze and prepare a
                  draft training automatically.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-bold text-[#111827]">
                  2. Configure Course & Assessment
                </h4>
                <p className="text-[13px] leading-relaxed text-[#6b7280]">
                  Define course structure, quiz settings, difficulty level, and deadlines.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-bold text-[#111827]">3. Review & Publish Course</h4>
                <p className="text-[13px] leading-relaxed text-[#6b7280]">
                  Review AI-generated lessons and quizzes, make adjustments, and approve for
                  publishing. Instantly make your training available for your team to access and
                  complete.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-bold text-[#111827]">4. Invite Workers to Course</h4>
                <p className="text-[13px] leading-relaxed text-[#6b7280]">
                  Assign courses to individuals or departments and track progress directly from your
                  dashboard.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
