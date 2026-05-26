'use client';

import { useRouter } from 'next/navigation';
import BillingGateModal from '@/components/dashboard/billing/BillingGateModal';

export default function AuditorBillingGateWrapper() {
  const router = useRouter();

  return (
    <BillingGateModal
      title="A plan is required for reports"
      description="Subscribe to a plan to generate auditor packs."
      onClose={() => router.push('/dashboard')}
    />
  );
}
