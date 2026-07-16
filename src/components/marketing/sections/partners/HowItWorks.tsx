import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Section } from '@/components/marketing/ui/Section';

/* --- UI fragments: idealised slices of the actual Theraptly product --- */

function IntroCard() {
  return (
    <div className="flex h-[204px] w-[250px] flex-col rounded-xl border border-black/[0.06] bg-white p-4 shadow-[0_14px_36px_-20px_rgba(20,20,60,0.4)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8a90a6]">
          New referral
        </span>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
          Referred by you
        </span>
      </div>
      <div className="flex flex-1 items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-[13px] font-semibold text-brand">
          SR
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[#001047]">Sunrise Recovery</p>
          <p className="text-[12px] text-[#676c80]">Behavioral health · 40 staff</p>
        </div>
      </div>
      <div className="rounded-lg bg-[#f4f7ff] px-3 py-2 text-[12px] leading-[1.4] text-[#3a4a70]">
        &ldquo;They&rsquo;d be a great fit for Theraptly.&rdquo;
      </div>
    </div>
  );
}

function OnboardingCard() {
  const items = ['Demo booked', 'Policies imported', 'Staff assigned'];
  return (
    <div className="flex h-[204px] w-[250px] flex-col rounded-xl border border-black/[0.06] bg-white p-4 shadow-[0_14px_36px_-20px_rgba(20,20,60,0.4)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#001047]">Onboarding</span>
        <span className="rounded-full bg-[#e7f6ec] px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
          On track
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {items.map((label) => (
          <li key={label} className="flex items-center gap-2.5">
            <span className="flex size-5 items-center justify-center rounded-full bg-[#e7f6ec] text-[#15803d]">
              <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            </span>
            <span className="text-[13px] text-[#3a4a70]">{label}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto border-t border-black/[0.06] pt-2.5 text-[12px] text-[#676c80]">
        Handled by Theraptly
      </div>
    </div>
  );
}

function PayoutCard() {
  const bars = [34, 52, 68, 84, 100];
  return (
    <div className="flex h-[204px] w-[250px] flex-col rounded-xl border border-black/[0.06] bg-white p-4 shadow-[0_14px_36px_-20px_rgba(20,20,60,0.4)]">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8a90a6]">
        Your commission
      </span>
      <div className="mt-1 flex items-end gap-2">
        <span className="font-display text-[34px] font-semibold leading-none text-brand">$600</span>
        <span className="pb-1 text-[12px] text-[#676c80]">Year 1 · 20%</span>
      </div>
      <div className="mt-3 flex h-14 items-end gap-1.5">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 rounded-t-[3px] bg-brand/80" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-black/[0.06] pt-2.5 text-[12px]">
        <span className="text-[#3a4a70]">Then $150/yr · 5%</span>
        <span className="font-semibold text-[#001047]">while active</span>
      </div>
    </div>
  );
}

const STEPS: { visual: ReactNode; title: string; body: string }[] = [
  {
    visual: <IntroCard />,
    title: 'Submit a warm intro',
    body: 'Introduce your client via a dedicated intro link or a shared email.',
  },
  {
    visual: <OnboardingCard />,
    title: 'We run it end to end',
    body: 'Our team owns the demo, onboarding, and 100% of support. Zero lift on you.',
  },
  {
    visual: <PayoutCard />,
    title: 'You get paid, automatically',
    body: 'Payouts land the moment a subscription activates — 20% year one, then 5% for life.',
  },
];

export function HowItWorks() {
  return (
    <Section className="bg-surface py-16 lg:py-24" innerClassName="flex flex-col items-center">
      <Reveal className="flex max-w-[680px] flex-col items-center gap-4 text-center">
        <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1c1917]">
          We do the heavy lifting. You keep advising.
        </h2>
        <p className="text-[clamp(1rem,1.3vw,1.15rem)] leading-[1.5] text-[#57534d]">
          No selling, no demos, no support tickets. Just the introduction.
        </p>
      </Reveal>

      <div className="mt-12 flex w-full touch-pan-x snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] max-md:-mx-4 max-md:px-4 md:mt-14 md:grid md:grid-cols-3 md:touch-auto md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden">
        {STEPS.map((step, i) => (
          <Reveal
            key={step.title}
            delay={i * 90}
            className="w-[80%] shrink-0 snap-start sm:w-[46%] md:w-auto md:min-w-0"
          >
            <article className="flex h-full flex-col rounded-2xl border border-black/[0.06] bg-white p-6">
              <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-xl bg-[#eef1fb]">
                <span className="absolute left-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/85 font-display text-[16px] font-semibold text-brand shadow-sm backdrop-blur-sm">
                  {i + 1}
                </span>
                {/* shader sheen — a slow drifting colour wash behind the UI card */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-[-30%] opacity-45 blur-2xl motion-safe:animate-shader-drift [background:radial-gradient(35%_35%_at_30%_30%,#2f4dff_0%,transparent_70%),radial-gradient(40%_40%_at_75%_65%,#37c6ff_0%,transparent_70%),radial-gradient(45%_45%_at_60%_88%,#a970ff_0%,transparent_70%)]"
                />
                <div className="absolute inset-0 @container flex items-center justify-center p-5">
                  <div className="shrink-0 [scale:min(1,tan(atan2(100cqw,250px)))]">
                    {step.visual}
                  </div>
                </div>
              </div>
              <h3 className="text-[20px] font-medium leading-tight text-[#1c1917]">{step.title}</h3>
              <p className="mt-2 text-[15px] leading-[1.5] text-[#57534d]">{step.body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
