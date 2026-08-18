'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import BillingGateModal from '@/components/dashboard/billing/BillingGateModal';

interface DashboardCreateCourseButtonProps {
  hasBilling: boolean;
}

/**
 * Billing-gated "Create Course" button for the admin dashboard.
 *
 * Mirrors the identical behaviour in CoursesListClient — shows the
 * CoursesBillingGate modal when the org lacks an active subscription,
 * and navigates directly to the wizard when billing is active.
 */
export default function DashboardCreateCourseButton({
  hasBilling,
}: DashboardCreateCourseButtonProps) {
  const router = useRouter();
  const [showBillingGate, setShowBillingGate] = useState(false);

  const handleClick = () => {
    if (!hasBilling) {
      setShowBillingGate(true);
      return;
    }
    router.push('/dashboard/courses/create');
  };

  return (
    <>
      <Button
        variant="default"
        size="lg"
        onClick={handleClick}
        id="dashboard-create-course-btn"
        className="h-8 gap-1.5 rounded-[8px] px-3 text-xs font-semibold tracking-[-0.31px] has-[>svg]:px-3 md:h-12 md:gap-2 md:rounded-[12px] md:px-6 md:text-[15.5px] md:has-[>svg]:px-6"
      >
        <Plus className="size-4 md:size-[25px]" aria-hidden="true" />
        Create Course
      </Button>

      {showBillingGate && (
        <BillingGateModal
          title="A plan is required to create courses"
          description="Subscribe to a plan to start creating and managing training courses for your organization."
          onClose={() => setShowBillingGate(false)}
        />
      )}
    </>
  );
}
