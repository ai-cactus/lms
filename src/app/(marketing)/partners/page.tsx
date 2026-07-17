import type { Metadata } from 'next';
import Navbar from '@/components/marketing/Navbar';
import { Footer } from '@/components/marketing/Footer';
import { PartnerHero } from '@/components/marketing/sections/partners/PartnerHero';
import { AboutTheraptly } from '@/components/marketing/sections/partners/AboutTheraptly';
import { HowItWorks } from '@/components/marketing/sections/partners/HowItWorks';
import { Earnings } from '@/components/marketing/sections/partners/Earnings';
import { Benefits } from '@/components/marketing/sections/partners/Benefits';
import { FoundingPartner } from '@/components/marketing/sections/partners/FoundingPartner';
import { ProgramFaq } from '@/components/marketing/sections/partners/ProgramFaq';
import { ApplyCta } from '@/components/marketing/sections/partners/ApplyCta';

export const metadata: Metadata = {
  title: 'Partner Program — Theraptly',
  description:
    'Refer behavioral-health facilities to Theraptly and earn 20% of their first year plus 5% recurring. We handle the demo, onboarding, and support — you just make the introduction.',
};

export default function PartnersPage() {
  return (
    <>
      <Navbar />
      <main>
        <PartnerHero />
        <AboutTheraptly />
        <HowItWorks />
        <Earnings />
        <Benefits />
        <FoundingPartner />
        <ProgramFaq />
        <ApplyCta />
      </main>
      <Footer />
    </>
  );
}
