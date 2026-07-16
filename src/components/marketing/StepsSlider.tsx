'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type Step = {
  image: string;
  title: string;
  description: string;
};

const AUTO_ADVANCE_MS = 3800;

export function StepsSlider({ steps }: { steps: Step[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const scrollToIndex = useCallback((index: number) => {
    const slide = slideRefs.current[index];
    const track = trackRef.current;
    if (!slide || !track) return;
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  }, []);

  // Auto-advance (respects reduced motion + pause-on-interaction)
  useEffect(() => {
    if (paused) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => {
      setActive((prev) => {
        const next = (prev + 1) % steps.length;
        scrollToIndex(next);
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, steps.length, scrollToIndex]);

  // Keep the active dot in sync while the user drags/scrolls
  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    let min = Infinity;
    slideRefs.current.forEach((slide, i) => {
      if (!slide) return;
      const slideCenter = slide.offsetLeft - track.offsetLeft + slide.clientWidth / 2;
      const dist = Math.abs(slideCenter - center);
      if (dist < min) {
        min = dist;
        nearest = i;
      }
    });
    setActive(nearest);
  }, []);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth pb-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {steps.map((step, i) => (
          <div
            key={step.title}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            className="w-[82%] shrink-0 snap-start sm:w-[56%] lg:w-[40%]"
          >
            {/* Phone card */}
            <div className="overflow-hidden rounded-2xl bg-gradient-to-b from-[#f1f1f2] to-[#f8f8f9] transition-[transform,box-shadow] duration-300 hover:shadow-[0px_18px_36px_-18px_rgba(9,34,86,0.22)] motion-safe:hover:-translate-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={step.image}
                alt={step.title}
                width={410}
                height={395}
                loading="lazy"
                draggable={false}
                className="h-auto w-full select-none"
              />
            </div>

            {/* Number + connecting line */}
            <div className="relative mt-9 flex items-center">
              <div className="z-10 flex size-[60px] shrink-0 items-center justify-center rounded-full bg-surface text-[22px] font-bold tracking-tight text-[#54668b]">
                {i + 1}
              </div>
              <div className="ml-3 h-[3px] flex-1 bg-surface" />
            </div>

            {/* Title + description */}
            <div className="mt-7 flex flex-col gap-2.5">
              <h3 className="text-[clamp(1.3rem,1.6vw,1.5625rem)] font-medium leading-[1.3] tracking-[-0.01em] text-[#092256]">
                {step.title}
              </h3>
              <p className="max-w-[40ch] text-[clamp(1rem,1.1vw,1.06rem)] font-medium leading-[1.65] text-[#3e588e]">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Dots */}
      <div className="mt-8 flex items-center gap-2">
        {steps.map((step, i) => (
          <button
            key={step.title}
            type="button"
            aria-label={`Go to step ${i + 1}`}
            aria-current={active === i}
            onClick={() => {
              setActive(i);
              scrollToIndex(i);
            }}
            className={cn(
              'h-2 rounded-full transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2',
              active === i ? 'w-7 bg-[#092256]' : 'w-2 bg-[#092256]/20 hover:bg-[#092256]/40',
            )}
          />
        ))}
      </div>
    </div>
  );
}
