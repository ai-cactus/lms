import type { Metadata } from 'next';

import Navbar from '@/components/marketing/Navbar';
import { Footer } from '@/components/marketing/Footer';
import HelpCenterContent from '@/components/help/HelpCenterContent';
import { getHelpPlanPricing } from '@/lib/help/pricing';

export const metadata: Metadata = {
  title: 'Help Center | Theraptly',
  description:
    'Answers to common questions about onboarding staff, creating and assigning courses, document storage and HIPAA compliance, audit reports, and Theraptly billing.',
};

export default async function PublicHelpPage() {
  const planPricing = await getHelpPlanPricing();

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-[800px] px-4 py-16">
          <HelpCenterContent audience="all" planPricing={planPricing} />
        </div>
      </main>
      <Footer />
    </>
  );
}
