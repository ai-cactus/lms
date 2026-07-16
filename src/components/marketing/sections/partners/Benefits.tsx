import type { ReactNode } from 'react';
import { LineChart, ShieldCheck, TrendingUp } from 'lucide-react';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Section } from '@/components/marketing/ui/Section';

const BENEFITS: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: 'Strengthen client trust',
    body: 'Hand clients a modern solution that eliminates manual training spreadsheets and mitigates audit risk — the kind of recommendation they remember.',
    icon: <ShieldCheck className="size-6" strokeWidth={1.6} aria-hidden="true" />,
  },
  {
    title: 'Frictionless oversight',
    body: 'Clear, exportable training records make your periodic compliance reviews faster and more data-driven.',
    icon: <LineChart className="size-6" strokeWidth={1.6} aria-hidden="true" />,
  },
  {
    title: 'Uncapped financial growth',
    body: "Capitalize on the network you've spent years building by introducing a tool your clients genuinely need — and earn on it for as long as they stay.",
    icon: <TrendingUp className="size-6" strokeWidth={1.6} aria-hidden="true" />,
  },
];

export function Benefits() {
  return (
    <Section className="bg-surface py-16 lg:py-24" innerClassName="flex flex-col items-center">
      <Reveal className="flex max-w-[720px] flex-col items-center gap-4 text-center">
        <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1c1917]">
          We don&rsquo;t replace your expertise. We scale it.
        </h2>
        <p className="text-[clamp(1rem,1.3vw,1.15rem)] leading-[1.55] text-[#57534d]">
          Your clients look to you for strategic protection. Theraptly gives you a modern tool to
          hand them — and a reason to deepen every relationship you&rsquo;ve built.
        </p>
      </Reveal>

      <div className="mt-12 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-14 lg:grid-cols-3">
        {BENEFITS.map((b, i) => (
          <Reveal key={b.title} delay={i * 70} className="h-full">
            <article className="flex h-full flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white p-7">
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                {b.icon}
              </span>
              <h3 className="text-[19px] font-medium leading-tight text-[#1c1917]">{b.title}</h3>
              <p className="text-[15px] leading-[1.55] text-[#57534d]">{b.body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
