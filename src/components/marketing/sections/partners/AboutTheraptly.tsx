import type { ReactNode } from 'react';
import { Clock, FileCheck, ShieldCheck, Users } from 'lucide-react';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Section } from '@/components/marketing/ui/Section';

const POINTS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <ShieldCheck className="size-[22px]" strokeWidth={1.6} aria-hidden="true" />,
    title: 'Policy-linked training',
    body: 'Built from the clinic’s own policies.',
  },
  {
    icon: <Clock className="size-[22px]" strokeWidth={1.6} aria-hidden="true" />,
    title: 'Timestamped records',
    body: 'Date, time & staff name on every completion.',
  },
  {
    icon: <Users className="size-[22px]" strokeWidth={1.6} aria-hidden="true" />,
    title: 'Role-based assignments',
    body: 'Assign by role in one click.',
  },
  {
    icon: <FileCheck className="size-[22px]" strokeWidth={1.6} aria-hidden="true" />,
    title: 'Audit-ready exports',
    body: 'Inspection-ready reports in seconds.',
  },
];

export function AboutTheraptly() {
  return (
    <Section className="bg-white py-16 lg:py-24" innerClassName="flex flex-col items-center">
      <Reveal className="flex max-w-[680px] flex-col items-center gap-4 text-center">
        <span className="text-[14px] font-semibold uppercase tracking-[0.08em] text-brand">
          Who we are
        </span>
        <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1c1917]">
          Empowering facilities. Simplifying compliance.
        </h2>
        <p className="text-[clamp(1rem,1.3vw,1.15rem)] leading-[1.5] text-[#57534d]">
          A purpose-built, automated LMS for healthcare and behavioral-health facilities. We
          streamline staff training, automate credential tracking, and generate ironclad audit
          trails — keeping your clients compliant 365 days a year, not just at inspection time.
        </p>
      </Reveal>

      {/* Product showcase */}
      <Reveal delay={80} className="mt-10 w-full max-w-[980px] lg:mt-12">
        <div className="overflow-hidden rounded-2xl border border-black/[0.06] shadow-[0px_20px_50px_-24px_rgba(20,20,60,0.25)]">
          <div className="flex items-center gap-2 bg-[#eae7e2] px-4 py-3">
            <span className="size-2.5 rounded-full bg-[#ED6A5E]/70" />
            <span className="size-2.5 rounded-full bg-[#F6BE4F]/70" />
            <span className="size-2.5 rounded-full bg-[#62C554]/70" />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/marketing/hero/dashboard.svg"
            alt="The Theraptly dashboard"
            className="block w-full"
          />
        </div>
      </Reveal>

      {/* Value points */}
      <div className="mt-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {POINTS.map((p, i) => (
          <Reveal key={p.title} delay={i * 70} className="h-full">
            <article className="flex h-full flex-col gap-3 rounded-2xl border border-black/[0.06] bg-[#fafafa] p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                {p.icon}
              </span>
              <h3 className="text-[17px] font-medium leading-tight text-[#001047]">{p.title}</h3>
              <p className="text-[14px] leading-[1.45] text-[#676c80]">{p.body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
