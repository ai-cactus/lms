'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';

const steps = [
  {
    id: 1,
    image: '/images/carousel-01.jpg',
    alt: 'Upload Training Documents Screen',
    title: 'Upload Your Policy',
    description:
      'Upload your policy or procedure, and Theraptly converts it into a ready-to-use training module with lessons and quizzes.',
  },
  {
    id: 2,
    image: '/images/carousel-02.jpg',
    alt: 'Training Principle Overview Screen',
    title: 'Assign & Train Your Team',
    description:
      'Assign courses to staff based on roles, track progress, and ensure everyone completes required training on time.',
  },
  {
    id: 3,
    image: '/images/carousel-03.jpg',
    alt: 'Assigned Courses Dashboard Screen',
    title: 'Track Performance & Be Audit-ready',
    description:
      'Get real-time insights on completion rates, quiz results, and CARF alignment—all in one dashboard.',
  },
];

const AUTO_SCROLL_INTERVAL = 3500; // ms

export default function HowItWorks() {
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % steps.length);
    }, AUTO_SCROLL_INTERVAL);
  }, []);

  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resetTimer]);

  const handleDotClick = (index: number) => {
    goTo(index);
    resetTimer(); // Reset auto-scroll on manual interaction
  };

  return (
    <section className="flex justify-center overflow-hidden bg-background px-4 py-12 sm:px-6 lg:px-6 lg:py-[100px]">
      <div className="grid w-full max-w-[1200px] grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-20">
        {/* Static left column */}
        <div className="flex flex-col">
          <h2 className="mb-2 text-2xl font-bold leading-tight text-[#0b1a38] sm:text-[32px] lg:text-[40px]">
            How it works
          </h2>
          <p className="mb-8 text-[15px] text-[#6b7280] sm:mb-12 sm:text-base">
            Just follow these easy steps
          </p>

          {/* Step text list — updates with active step */}
          <div className="mb-10 flex flex-col gap-2">
            {steps.map((step, i) => {
              const isActive = i === activeIndex;
              return (
                <button
                  key={step.id}
                  className={`flex w-full items-start gap-4 rounded-2xl p-4 text-left transition-colors duration-200 hover:bg-[#f6f6f5] sm:gap-5 sm:p-5 ${
                    isActive ? 'bg-[#f6f6f5]' : 'bg-transparent'
                  }`}
                  onClick={() => handleDotClick(i)}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold transition-colors duration-200 ${
                      isActive ? 'bg-[#0b1a38] text-white' : 'bg-[#e5e7eb] text-[#374151]'
                    }`}
                  >
                    {step.id}
                  </span>
                  <div>
                    <p className="mb-1.5 text-[15px] font-semibold leading-tight text-[#0b1a38] sm:text-base">
                      {step.title}
                    </p>
                    <p className="hidden max-w-[400px] text-sm leading-relaxed text-[#6b7280] sm:block">
                      {step.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Dot indicators */}
          <div className="flex justify-center gap-2 sm:justify-start">
            {steps.map((step, i) => {
              const isActive = i === activeIndex;
              return (
                <button
                  key={step.id}
                  className={`h-2 rounded-full transition-all duration-200 ${
                    isActive ? 'w-6 bg-[#0b1a38]' : 'w-2 bg-[#d1d5db]'
                  }`}
                  onClick={() => handleDotClick(i)}
                  aria-label={`Go to step ${step.id}`}
                />
              );
            })}
          </div>
        </div>

        {/* Scrolling right column */}
        <div className="overflow-hidden rounded-3xl bg-[#f6f6f5]">
          <div
            className="flex transition-transform duration-[600ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{
              width: `${steps.length * 100}%`,
              transform: `translateX(-${activeIndex * (100 / steps.length)}%)`,
            }}
          >
            {steps.map((step) => (
              <div
                className="flex min-h-[280px] flex-1 items-end justify-center px-5 pt-5 sm:min-h-[400px] sm:px-8 sm:pt-8 lg:min-h-[520px] lg:px-10 lg:pt-10"
                key={step.id}
              >
                <div className="relative w-full max-w-[320px]">
                  <Image
                    src={step.image}
                    alt={step.alt}
                    width={320}
                    height={480}
                    className="block h-auto w-full object-contain"
                    priority={step.id === 1}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
