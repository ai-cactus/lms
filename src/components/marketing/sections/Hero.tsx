import { AnnouncementBanner } from '@/components/marketing/ui/AnnouncementBanner';
import { Button } from '@/components/marketing/ui/Button';
import { Section } from '@/components/marketing/ui/Section';
import { ArrowRight } from '@/components/marketing/ui/icons';
import { RotatingWord } from '@/components/marketing/RotatingWord';

const ROTATING_WORDS = ['documentation.', 'records.', 'proof.'];

export function Hero() {
  return (
    <Section
      className="relative overflow-hidden bg-surface pb-20 pt-14 sm:pb-24 sm:pt-16 lg:pb-32 lg:pt-20"
      innerClassName="relative"
    >
      {/* Ambient warm glow behind the headline */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-[420px] max-w-[820px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,3,219,0.07),transparent_70%)] blur-2xl"
      />

      {/* Copy — staggered entrance (sits above the blob) */}
      <div className="relative z-20 mx-auto flex max-w-[900px] flex-col items-center gap-6 text-center lg:max-w-[1040px]">
        <div className="motion-safe:animate-fade-up">
          <AnnouncementBanner badge="New" href="#whats-new">
            Theraptly LMS:
          </AnnouncementBanner>
        </div>

        <h1 className="font-display font-semibold tracking-[-0.03em] text-[#1c1917] motion-safe:animate-fade-up motion-safe:[animation-delay:90ms]">
          <span className="block text-balance text-[clamp(2.1rem,5.4vw,3.75rem)] leading-[1.05]">
            Be ready when inspectors ask for
          </span>
          <span className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 text-[clamp(2.25rem,5.8vw,4rem)] leading-[1.05]">
            staff training <RotatingWord words={ROTATING_WORDS} />
          </span>
        </h1>

        <p className="max-w-[620px] text-balance text-[clamp(1.02rem,1.35vw,1.2rem)] font-normal leading-[1.6] tracking-[-0.005em] text-[#57534d] motion-safe:animate-fade-up motion-safe:[animation-delay:180ms] lg:max-w-[740px]">
          Theraptly turns your clinic policies into structured staff training — with timestamped
          completion records you can export the moment they are requested. No spreadsheets. No
          chasing staff. No scrambling before surveys.
        </p>

        <div className="mt-1 flex w-full flex-col items-center gap-3 motion-safe:animate-fade-up motion-safe:[animation-delay:270ms] sm:w-auto sm:flex-row">
          <Button
            href="/signup"
            variant="dark"
            size="lg"
            shape="pill"
            fullWidth
            className="group/btn transition-transform hover:-translate-y-0.5 sm:w-auto"
            trailingIcon={
              <ArrowRight className="size-[18px] transition-transform group-hover/btn:translate-x-0.5" />
            }
          >
            Start for free
          </Button>
          <Button
            href="/request-demo"
            variant="soft"
            size="lg"
            shape="pill"
            fullWidth
            className="transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            Request Demo
          </Button>
        </div>
      </div>

      {/* Product shot */}
      <div className="relative z-10 mx-auto mt-12 w-full max-w-[1120px] motion-safe:animate-rise-in motion-safe:[animation-delay:360ms] sm:mt-14">
        {/* Decorative blob — original width spans the screen (100vw) at its
            natural aspect ratio, vertically centered behind the glass image. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 w-screen max-w-none -translate-x-1/2 -translate-y-1/2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/hero/blob.svg" alt="" width={2012} height={837} className="w-full" />
        </div>

        {/* LAYER 1 — glassy panel. The blob behind frosts through the
            translucent mat around the window. */}
        <div className="rounded-[20px] border border-white/50 bg-white/30 p-2 shadow-[0px_2px_4px_rgba(20,20,60,0.04),0px_12px_24px_-8px_rgba(20,20,60,0.10),0px_48px_90px_-28px_rgba(20,20,60,0.30),inset_0px_1px_0px_rgba(255,255,255,0.7)] backdrop-blur-xl sm:rounded-[28px] sm:p-3">
          {/* LAYER 2 — browser window: controls bar + dashboard SVG */}
          <div className="overflow-hidden rounded-xl ring-1 ring-black/[0.06] sm:rounded-[20px]">
            {/* Browser controls (mac-style dots, 30% opacity per Figma) —
                sit directly on the glass parent background, no bar fill */}
            <div className="flex items-center gap-2 px-4 py-[15px]">
              <span className="flex items-center gap-2 opacity-60">
                <span className="size-3 rounded-full bg-[#ED6A5E]" />
                <span className="size-3 rounded-full bg-[#F6BE4F]" />
                <span className="size-3 rounded-full bg-[#62C554]" />
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/marketing/hero/dashboard.svg"
              alt="Theraptly dashboard showing a staff member's training transcript with course completion, scores, and attestation dates."
              width={1104}
              height={715}
              fetchPriority="high"
              decoding="async"
              className="block h-auto w-full"
            />
          </div>
        </div>
      </div>
    </Section>
  );
}
