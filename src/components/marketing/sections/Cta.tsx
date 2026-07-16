import Link from 'next/link';
import { LogoMark } from '@/components/marketing/ui/Logo';
import { Reveal } from '@/components/marketing/ui/Reveal';

const gutter = 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-12 xl:px-[110px]';

export function Cta() {
  return (
    <section id="get-started" className="relative overflow-hidden bg-brand">
      {/* Depth + diagonal shading */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,0.08)_0%,transparent_38%),linear-gradient(to_bottom_right,transparent_55%,rgba(0,0,30,0.22)_100%)]"
      />
      {/* Logomark watermark */}
      <LogoMark className="pointer-events-none absolute -right-12 -top-20 size-[360px] text-[#2c3cff] sm:size-[440px] lg:-right-6 lg:-top-24 lg:size-[480px]" />

      <div className={`${gutter} relative py-20 sm:py-24 lg:py-28`}>
        <Reveal className="flex max-w-[660px] flex-col items-start gap-7">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-[clamp(2rem,4.4vw,3rem)] font-semibold leading-[1.07] tracking-[-0.02em] text-white">
              Work smarter, Stay Compliant with Theraptly
            </h2>
            <p className="max-w-[420px] text-[clamp(1rem,1.2vw,1.15rem)] leading-[1.45] text-[#f1f1f1]">
              Start automating tasks today and give your team more time to focus on what matters.
            </p>
          </div>

          <Link
            href="/request-demo"
            className="rounded-full bg-white px-8 py-4 text-[clamp(1rem,1.2vw,1.28rem)] font-medium tracking-[-0.01em] text-black shadow-sm outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
          >
            Request a demo
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
