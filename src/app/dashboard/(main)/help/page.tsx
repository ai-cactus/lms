import HelpCenterContent from '@/components/help/HelpCenterContent';
import { getHelpPlanPricing } from '@/lib/help/pricing';

export const metadata = {
  title: 'Help Center | Theraptly LMS',
  description: 'Answers to common questions and how to reach Theraptly support.',
};

export default async function DashboardHelpPage() {
  const planPricing = await getHelpPlanPricing();

  return <HelpCenterContent audience="admin" planPricing={planPricing} />;
}
