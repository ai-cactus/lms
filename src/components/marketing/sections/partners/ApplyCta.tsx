import { Check } from 'lucide-react';
import { PartnerApplicationForm } from '@/components/marketing/PartnerApplicationForm';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Section } from '@/components/marketing/ui/Section';

const WHO = [
  'Compliance & accreditation consultants (CARF, Joint Commission)',
  'Behavioral-health operations & practice advisors',
  'Billing & practice-management consultants',
  'EHR / implementation consultants',
  'Anyone advising 11–50 staff care facilities',
];

function CheckBadge() {
  return (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
      <Check className="size-3" strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

export function ApplyCta() {
  return (
    <Section id="apply" className="bg-white py-16 lg:py-24">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Left — pitch + who it's for */}
        <Reveal className="flex flex-col gap-6">
          <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1c1917]">
            Ready to scale your practice?
          </h2>
          <p className="max-w-[440px] text-[clamp(1rem,1.3vw,1.15rem)] leading-[1.55] text-[#57534d]">
            Let&rsquo;s make compliance effortless for your clients — and rewarding for you. Apply
            below and we&rsquo;ll be in touch within two business days.
          </p>

          <div>
            <p className="mb-3 text-[14px] font-semibold uppercase tracking-[0.06em] text-brand">
              A great fit if you&rsquo;re one of these
            </p>
            <ul className="flex flex-col gap-2.5">
              {WHO.map((w) => (
                <li key={w} className="flex gap-3 text-[15px] leading-[1.45] text-ink">
                  <CheckBadge />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        {/* Right — form */}
        <Reveal delay={100}>
          <PartnerApplicationForm />
        </Reveal>
      </div>
    </Section>
  );
}
