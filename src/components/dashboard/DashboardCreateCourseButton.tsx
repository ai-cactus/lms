'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
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
      <Button variant="primary" onClick={handleClick} id="dashboard-create-course-btn">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: 8 }}
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
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
