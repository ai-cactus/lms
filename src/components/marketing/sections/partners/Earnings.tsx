import { PartnerCalculator } from '@/components/marketing/PartnerCalculator';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Section } from '@/components/marketing/ui/Section';

const SCALE = [
  { facilities: 5, year1: '$3,000', recurring: '$750' },
  { facilities: 10, year1: '$6,000', recurring: '$1,500' },
  { facilities: 25, year1: '$15,000', recurring: '$3,750' },
  { facilities: 50, year1: '$30,000', recurring: '$7,500' },
];

export function Earnings() {
  return (
    <Section
      id="earnings"
      className="bg-white py-16 lg:py-24"
      innerClassName="flex flex-col items-center"
    >
      <Reveal className="flex max-w-[760px] flex-col items-center gap-4 text-center">
        <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1c1917]">
          Transparent rewards. Compounding value.
        </h2>
        <p className="text-[clamp(1rem,1.3vw,1.15rem)] leading-[1.55] text-[#57534d]">
          A front-weighted commission structure with a lifetime renewal tail — because compliance
          software is sticky, and your portfolio should be too.
        </p>
      </Reveal>

      {/* Two commission cards */}
      <div className="mt-12 grid w-full max-w-[840px] grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-14">
        <Reveal className="h-full">
          <div className="flex h-full flex-col gap-2 rounded-2xl border border-black/[0.06] bg-[#fafafa] p-7">
            <span className="text-[14px] font-medium text-[#57534d]">Year 1 bounty · 20%</span>
            <span className="font-display text-[clamp(2.4rem,5vw,3.25rem)] font-semibold leading-none text-brand">
              $600
            </span>
            <span className="text-[15px] text-[#57534d]">
              One-time, for every facility that subscribes.
            </span>
          </div>
        </Reveal>
        <Reveal delay={80} className="h-full">
          <div className="flex h-full flex-col gap-2 rounded-2xl border border-black/[0.06] bg-[#fafafa] p-7">
            <span className="text-[14px] font-medium text-[#57534d]">Year 2+ residual · 5%</span>
            <span className="font-display text-[clamp(2.4rem,5vw,3.25rem)] font-semibold leading-none text-[#1c1917]">
              $150<span className="text-[0.5em] font-medium text-[#57534d]">/yr</span>
            </span>
            <span className="text-[15px] text-[#57534d]">
              Every year the facility stays an active customer.
            </span>
          </div>
        </Reveal>
      </div>

      {/* Scale table */}
      <Reveal className="mt-4 w-full max-w-[840px]">
        <div className="overflow-hidden rounded-2xl border border-black/[0.06]">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#fafafa] text-[13px] uppercase tracking-[0.04em] text-[#57534d]">
                <th className="px-5 py-3 font-medium">Active referred facilities</th>
                <th className="px-5 py-3 font-medium">Year 1 (one-time)</th>
                <th className="px-5 py-3 font-medium">Annual passive (Year 2+)</th>
              </tr>
            </thead>
            <tbody>
              {SCALE.map((row, i) => (
                <tr key={row.facilities} className={i > 0 ? 'border-t border-black/[0.06]' : ''}>
                  <td className="px-5 py-3.5 text-[15px] font-medium text-ink">
                    {row.facilities} facilities
                  </td>
                  <td className="px-5 py-3.5 font-display text-[16px] font-semibold text-brand">
                    {row.year1}
                  </td>
                  <td className="px-5 py-3.5 text-[15px] text-[#57534d]">{row.recurring}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      {/* Compounding callout */}
      <Reveal className="mt-4 w-full max-w-[840px]">
        <div className="rounded-2xl bg-[#1c1917] p-7 text-center sm:p-8">
          <p className="mx-auto max-w-[560px] text-balance text-[clamp(1.05rem,1.5vw,1.3rem)] leading-[1.45] text-white">
            Refer around{' '}
            <span className="font-display font-semibold text-white">10 facilities a year</span> and
            your residuals stack on every new cohort — roughly{' '}
            <span className="font-display font-semibold text-[#8ea2ff]">
              $45,000 over five years
            </span>
            .
          </p>
        </div>
      </Reveal>

      {/* Interactive calculator */}
      <div className="mt-10 w-full max-w-[960px] lg:mt-14">
        <Reveal className="mb-5 text-center">
          <h3 className="font-display text-[clamp(1.4rem,2.4vw,1.85rem)] font-semibold text-[#1c1917]">
            Run your own numbers
          </h3>
        </Reveal>
        <Reveal delay={80}>
          <PartnerCalculator />
        </Reveal>
      </div>
    </Section>
  );
}
