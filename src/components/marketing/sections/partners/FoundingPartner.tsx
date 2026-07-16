import { LogoMark } from '@/components/marketing/ui/Logo';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Section } from '@/components/marketing/ui/Section';

export function FoundingPartner() {
  return (
    <Section className="bg-white py-16 lg:py-24" innerClassName="flex flex-col items-center">
      <Reveal className="w-full max-w-[840px]">
        <div className="flex flex-col items-center gap-6 rounded-[24px] border border-black/[0.06] bg-[#fafafa] px-6 py-10 text-center sm:px-12 sm:py-14">
          <LogoMark className="size-10" />
          <span className="inline-flex items-center rounded-full border border-brand/20 bg-brand/[0.06] px-3 py-1 text-[13px] font-medium text-brand">
            Founding partners
          </span>
          <p className="max-w-[620px] text-balance font-display text-[clamp(1.25rem,2.4vw,1.7rem)] font-medium leading-[1.35] tracking-[-0.01em] text-[#1c1917]">
            &ldquo;We&rsquo;re taking on a handful of founding partners — consultants who know this
            space and want to shape the program. Expect direct access, priority support for your
            referrals, and a real say in what we build.&rdquo;
          </p>
          <p className="text-[15px] font-medium text-[#57534d]">— The Theraptly team</p>
        </div>
      </Reveal>
    </Section>
  );
}
