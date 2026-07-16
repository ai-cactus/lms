import Image from 'next/image';
import { Button } from '@/components/marketing/ui/Button';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { ArrowRight } from '@/components/marketing/ui/icons';

const gutter = 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-12 xl:px-[110px]';

export function PartnerHero() {
  return (
    <section className="relative isolate -mt-[71px] flex min-h-svh flex-col justify-center overflow-hidden sm:-mt-[95px] xl:-mt-[103px]">
      {/* Background photograph */}
      <Image
        src="/marketing/advantage/woman.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover object-center"
      />
      {/* Brand-tinted scrim keeps the overlaid copy legible */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-[#04061c]/90 via-[#060a34]/80 to-[#0a1270]/64"
      />

      <Reveal
        className={`${gutter} flex flex-col items-center pt-[71px] text-center sm:pt-[95px] xl:pt-[103px]`}
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[clamp(0.75rem,1.1vw,0.85rem)] font-medium text-white backdrop-blur-sm">
          <span className="size-1.5 rounded-full bg-white" />
          Theraptly Partner Program
        </span>

        <h1 className="mt-7 max-w-[16ch] font-display text-[clamp(2.35rem,6.4vw,4.5rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-white sm:mt-8">
          Turn warm intros into
          <br className="hidden sm:block" /> recurring revenue
        </h1>

        <p className="mt-5 max-w-[38ch] text-balance text-[clamp(1.05rem,1.7vw,1.4rem)] leading-[1.5] text-white/85 sm:mt-6">
          Refer facilities from your network. Earn{' '}
          <strong className="font-semibold text-white">20%</strong> of year one, then{' '}
          <strong className="font-semibold text-white">5%</strong> for as long as they stay — we
          handle the rest.
        </p>

        <div className="mt-9 flex w-full flex-col items-center gap-4 sm:mt-11 sm:w-auto sm:flex-row sm:gap-3">
          <Button
            href="#apply"
            variant="brand"
            size="lg"
            fullWidth
            className="group/btn transition-transform hover:-translate-y-0.5 sm:w-auto"
            trailingIcon={
              <ArrowRight className="size-[18px] transition-transform group-hover/btn:translate-x-0.5" />
            }
          >
            Become a partner
          </Button>
          <Button
            href="#earnings"
            variant="white"
            size="lg"
            fullWidth
            className="transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            See the numbers
          </Button>
        </div>
      </Reveal>
    </section>
  );
}
