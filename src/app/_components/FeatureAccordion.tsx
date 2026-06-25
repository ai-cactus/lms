'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SlidersHorizontal, User, BarChart3, ShieldCheck, ChevronDown } from 'lucide-react';

const accordionData = [
  {
    id: 'policies',
    title: 'Policies',
    icon: <SlidersHorizontal className="size-6" aria-hidden="true" />,
    content: 'Control user access and simplify logins for your clinical and compliance teams.',
  },
  {
    id: 'training',
    title: 'Training',
    icon: <User className="size-6" aria-hidden="true" />,
    content:
      'Deliver role-based assigned trainings tailored specifically to behavioral health environments.',
  },
  {
    id: 'records',
    title: 'Completion records',
    icon: <BarChart3 className="size-6" aria-hidden="true" />,
    content:
      'Automatically track and timestamp completion data to instantly verify staff compliance.',
  },
  {
    id: 'docs',
    title: 'Inspection documentation',
    icon: <ShieldCheck className="size-6" aria-hidden="true" />,
    content: 'Generate audit-ready reports matching state and CARF requirements with one click.',
  },
];

export default function FeatureAccordion() {
  const [openIndex, setOpenIndex] = useState<number>(0);

  return (
    <section className="flex flex-col items-center bg-background px-4 py-14 sm:px-6 lg:px-6 lg:py-[100px]">
      <div className="mb-12 flex w-full max-w-[1200px] flex-col gap-10 lg:mb-[60px] lg:flex-row lg:gap-20">
        <div className="max-w-[480px] flex-1 lg:pt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.05em] text-[#0b1a38] sm:mb-4 sm:text-base">
            STAFF TRAINING &amp; DOCUMENTATION
          </h2>
          <p className="text-xl leading-relaxed text-[#6b7280] sm:text-[26px]">
            When inspectors ask for documentation, you already have it.
          </p>
        </div>

        <div className="flex-1 lg:flex-[1.2]">
          <div className="flex flex-col border-t border-[#f3f4f6]">
            {accordionData.map((item, index) => {
              const isOpen = index === openIndex;
              return (
                <div key={item.id} className="flex flex-col border-b border-[#f3f4f6]">
                  <button
                    className="flex w-full cursor-pointer items-center justify-between bg-transparent py-5 text-left sm:py-6"
                    onClick={() => setOpenIndex(index)}
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-4">
                      <span className="flex items-center justify-center text-[#0b1a38]">
                        {item.icon}
                      </span>
                      <span className="text-base font-semibold text-[#0b1a38] sm:text-lg">
                        {item.title}
                      </span>
                    </div>
                    <span className="flex items-center text-[#0b1a38]">
                      <ChevronDown
                        className={`size-5 transition-transform duration-300 ${
                          isOpen ? 'rotate-180' : 'rotate-0'
                        }`}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ${
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="pb-6 pl-0 pt-2 text-sm leading-relaxed text-[#4b5563] sm:pb-8 sm:pl-10 sm:pt-0 sm:text-[15px]">
                        {item.content}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
        <Link
          href="/signup"
          className="inline-flex w-full items-center justify-center rounded-full bg-[#0b1a38] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#172a50] sm:w-auto sm:px-7 sm:py-3.5 sm:text-base"
        >
          Start for free &rarr;
        </Link>
        <Link
          href="/request-demo"
          className="inline-flex w-full items-center justify-center rounded-full bg-[#f3f4f6] px-6 py-3 text-[15px] font-semibold text-[#0b1a38] transition-colors hover:bg-[#e5e7eb] sm:w-auto sm:px-7 sm:py-3.5 sm:text-base"
        >
          Request Demo
        </Link>
      </div>
    </section>
  );
}
