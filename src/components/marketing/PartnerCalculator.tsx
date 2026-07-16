'use client';

import { useState } from 'react';

const YEARLY_PRICE = 3000; // $250/mo, 11–50 staff tier
const Y1_PER_FACILITY = YEARLY_PRICE * 0.2; // $600
const RESIDUAL_PER_FACILITY = YEARLY_PRICE * 0.05; // $150

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium text-ink">{label}</span>
        <span className="font-display text-[22px] font-semibold leading-none text-brand">
          {value}
          <span className="ml-1 text-[12px] font-medium text-[#57534d]">{suffix}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="range-brand mt-3.5 w-full cursor-pointer"
        style={{
          background: `linear-gradient(to right, #0003db ${pct}%, rgba(0,0,0,0.07) ${pct}%)`,
        }}
      />
      <div className="mt-2 flex justify-between text-[11px] font-medium text-[#a8a29e]">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export function PartnerCalculator() {
  const [refsPerYear, setRefsPerYear] = useState(10);
  const [years, setYears] = useState(5);

  // Stacking-cohort model: each year a new cohort earns 20%, and every prior
  // cohort still active (within the retention horizon) earns 5%.
  const yearly = Array.from({ length: years }, (_, i) => {
    const priorActiveCohorts = i; // years 0..i-1 all still active within horizon
    return refsPerYear * Y1_PER_FACILITY + refsPerYear * RESIDUAL_PER_FACILITY * priorActiveCohorts;
  });

  const newEachYear = refsPerYear * Y1_PER_FACILITY;
  const year1 = yearly[0];
  const finalYear = yearly[yearly.length - 1];
  const total = yearly.reduce((a, b) => a + b, 0);
  const maxYear = Math.max(...yearly);

  return (
    <div className="overflow-hidden rounded-3xl border border-black/[0.06] bg-white shadow-[0_2px_34px_-16px_rgba(20,20,60,0.22)]">
      <div className="grid lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* ---- Inputs ---- */}
        <div className="flex flex-col gap-8 border-b border-black/[0.06] bg-surface p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8a877f]">
            Your inputs
          </p>
          <Slider
            label="Facilities you refer / year"
            value={refsPerYear}
            min={1}
            max={50}
            suffix="/yr"
            onChange={setRefsPerYear}
          />
          <Slider
            label="Years each client stays"
            value={years}
            min={1}
            max={7}
            suffix={years === 1 ? 'yr' : 'yrs'}
            onChange={setYears}
          />
          <p className="mt-auto border-t border-black/[0.06] pt-5 text-[12px] leading-[1.5] text-[#57534d]">
            Based on the $250/mo (11–50 staff) plan — 20% of Year 1, then 5% every year a facility
            stays.
          </p>
        </div>

        {/* ---- Results ---- */}
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          {/* Hero payoff */}
          <div className="rounded-2xl bg-brand/[0.06] p-6">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-brand/70">
              You could earn over {years} {years === 1 ? 'year' : 'years'}
            </p>
            <p className="mt-2 font-display text-[clamp(2.75rem,7vw,3.75rem)] font-semibold leading-[0.95] tracking-[-0.02em] text-brand">
              {money(total)}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-brand/10 pt-4">
              <div>
                <p className="font-display text-[20px] font-semibold text-ink">{money(year1)}</p>
                <p className="mt-0.5 text-[12px] text-[#57534d]">in year 1</p>
              </div>
              <div>
                <p className="font-display text-[20px] font-semibold text-ink">
                  {money(finalYear)}
                  <span className="text-[13px] font-medium text-[#57534d]">/yr</span>
                </p>
                <p className="mt-0.5 text-[12px] text-[#57534d]">by year {years}</p>
              </div>
            </div>
          </div>

          {/* Year-by-year breakdown */}
          <div>
            <div className="mb-3.5 flex items-center gap-4 text-[12px] text-[#57534d]">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px] bg-brand" />
                New referrals
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px] bg-brand/35" />
                Recurring
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {yearly.map((v, i) => {
                const recurring = v - newEachYear;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-9 shrink-0 text-[12px] font-medium text-[#57534d]">
                      Yr {i + 1}
                    </span>
                    <span className="relative h-7 flex-1 overflow-hidden rounded-lg bg-black/[0.04]">
                      <span
                        className="absolute inset-y-0 left-0 flex overflow-hidden rounded-lg transition-[width] duration-500 ease-out"
                        style={{ width: `${Math.max(4, (v / maxYear) * 100)}%` }}
                      >
                        <span className="h-full bg-brand" style={{ flexGrow: newEachYear }} />
                        {recurring > 0 && (
                          <span className="h-full bg-brand/35" style={{ flexGrow: recurring }} />
                        )}
                      </span>
                    </span>
                    <span className="w-16 shrink-0 text-right text-[13px] font-semibold text-ink">
                      {money(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
