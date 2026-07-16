import { Accordion, type AccordionItem } from '@/components/marketing/Accordion';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Section } from '@/components/marketing/ui/Section';

const FAQS: AccordionItem[] = [
  {
    title: 'How and when do I get paid?',
    description:
      'Monthly, on collected revenue — you earn as your referred facility actually pays. If a client signs an annual plan upfront, you can take your full first-year commission as a single lump sum.',
  },
  {
    title: 'What counts as a referral?',
    description:
      'A facility you introduce — that we weren’t already in conversation with — which becomes a paying customer. A warm email introduction is enough to start the clock.',
  },
  {
    title: 'How long is a referral protected?',
    description:
      'For 90 days from your introduction. If the facility signs within that window, the commission is yours — even if the deal takes a few weeks to close.',
  },
  {
    title: 'Do I have to sell or run demos?',
    description:
      'No. We handle every demo, onboarding, training setup, and support conversation. You make the introduction; we do the work.',
  },
  {
    title: 'What happens if a client cancels?',
    description:
      'Your 5% residual simply stops when the account does — there are no clawbacks, except on refunds inside the first 60 days.',
  },
  {
    title: 'Is there a cap on how much I can earn?',
    description:
      'None. The more active facilities you refer, the larger your recurring income — and it stacks every year they stay.',
  },
];

export function ProgramFaq() {
  return (
    <Section className="bg-white py-16 lg:py-24">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <Reveal>
          <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1c1917]">
            Questions,
            <br className="hidden lg:block" /> answered
          </h2>
          <p className="mt-4 max-w-[360px] text-[clamp(1rem,1.3vw,1.15rem)] leading-[1.55] text-[#57534d]">
            The terms are transparent by design. Here&rsquo;s exactly how it works.
          </p>
        </Reveal>
        <Reveal delay={100}>
          <Accordion items={FAQS} />
        </Reveal>
      </div>
    </Section>
  );
}
