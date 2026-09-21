'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface SlideDeckShellProps {
  /** Module title with its "Module n:" prefix already stripped. */
  moduleTitle: string;
  moduleIndex: number;
  totalModules: number;
  /** One entry per thumbnail in the rail, in deck order. */
  slides: readonly { heading: string }[];
  activeSlideIndex: number;
  onSelectSlide: (index: number) => void;
  /** Controls for the top bar, e.g. the view toggle or the editor's Save. */
  headerActions?: React.ReactNode;
  /** Full-width slot under the top bar, e.g. a save error. */
  banner?: React.ReactNode;
  /** Heading rendered above the slide body. Omitted when the body carries its own. */
  slideHeading?: string;
  onBack: () => void;
  onNext: () => void;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  children: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * The slide deck chrome — top bar, thumbnail rail, card and footer navigation —
 * shared by the learner's viewer (`CourseSlide`) and the admin's in-place
 * editor (`AdminSlideEditor`), so an admin edits on the same surface a learner
 * reads. Layout only: pagination, keyboard handling and content belong to the
 * consumer.
 *
 * Rail geometry follows Figma LMS - 166 (120px previews at 16:10, ~15px apart),
 * which is the same rail the wizard's review deck already builds. The frame
 * carries no slide number and no selected state, so both are additions on top
 * of it.
 */
export default function SlideDeckShell({
  moduleTitle,
  moduleIndex,
  totalModules,
  slides,
  activeSlideIndex,
  onSelectSlide,
  headerActions,
  banner,
  slideHeading,
  onBack,
  onNext,
  backDisabled = false,
  nextDisabled = false,
  children,
  className = '',
  ref,
}: SlideDeckShellProps) {
  const totalSlides = slides.length;

  return (
    <div
      className={`flex h-full w-full flex-col bg-background-secondary outline-none ${className}`}
      ref={ref}
      tabIndex={-1}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-default bg-background px-4 py-2.5 md:px-6 md:py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-foreground md:text-sm">
            Module {moduleIndex + 1}: {moduleTitle}
          </span>
          <span className="rounded-full bg-background-secondary px-2.5 py-1 text-[10px] font-medium text-text-muted md:text-xs">
            Slide {activeSlideIndex + 1} of {totalSlides}
          </span>
        </div>
        <div className="flex items-center gap-3">{headerActions}</div>
      </div>

      {banner && (
        <div className="shrink-0 border-b border-border-default bg-background px-4 py-3 md:px-6">
          {banner}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav
          aria-label="Slides"
          className="hidden w-[144px] shrink-0 flex-col gap-3.5 overflow-y-auto border-r border-border-default bg-background px-3 py-4 md:flex"
        >
          {slides.map((slide, i) => {
            const isActive = i === activeSlideIndex;
            return (
              <button
                key={i}
                type="button"
                className={`flex aspect-[16/10] w-full shrink-0 flex-col gap-0.5 overflow-hidden rounded-lg border-[1.5px] bg-background px-1.5 py-1 text-left transition-all hover:border-text-muted hover:shadow-[0_2px_6px_rgba(0,0,0,0.06)] ${isActive ? 'border-primary shadow-[0_0_0_1px_var(--primary),0_2px_8px_rgba(71,48,247,0.12)]' : 'border-border-default'}`}
                onClick={() => onSelectSlide(i)}
                aria-label={`Go to slide ${i + 1}${slide.heading ? `: ${slide.heading}` : ''}`}
                aria-current={isActive ? 'true' : undefined}
              >
                {/* Filled pill, not bare text: the number has to stay readable
                    whatever the slide's own content puts behind it. */}
                <span
                  aria-hidden="true"
                  className={`inline-flex h-4 w-fit min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${isActive ? 'bg-primary text-primary-foreground' : 'bg-text-muted text-background'}`}
                >
                  {i + 1}
                </span>
                {slide.heading && (
                  <span
                    className={`line-clamp-3 text-[10px] leading-[1.3] ${isActive ? 'font-bold text-foreground' : 'font-semibold text-text-muted'}`}
                  >
                    {slide.heading}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-3 py-4 md:px-8 md:py-6">
          <div className="relative mx-auto flex w-full max-w-full flex-1 flex-col overflow-hidden rounded-xl border border-border-default bg-background shadow-[0_4px_16px_rgba(0,0,0,0.06)] md:max-w-[820px]">
            <div className="h-1.5 w-full shrink-0 bg-success" />
            <div className="flex flex-1 flex-col overflow-y-auto px-[18px] py-4 md:px-9 md:py-7">
              <div className="mb-2 flex items-center justify-between md:mb-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">
                  Module {moduleIndex + 1}
                </span>
                <span className="text-[11px] font-semibold text-text-muted">
                  {moduleIndex + 1} / {totalModules}
                </span>
              </div>

              <h2 className="mb-2 text-lg font-extrabold leading-[1.2] tracking-[-0.02em] text-foreground sm:text-xl md:text-[26px]">
                {moduleTitle}
              </h2>

              {slideHeading && (
                <h3 className="mb-3 mt-1 text-base font-semibold tracking-[-0.01em] text-primary">
                  {slideHeading}
                </h3>
              )}

              <div className="my-3 h-px bg-border-default md:my-4" />

              {children}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between pt-3 md:pt-4">
            <Button variant="outline" size="sm" onClick={onBack} disabled={backDisabled}>
              Back
            </Button>
            <span className="text-xs font-medium text-text-muted">
              {activeSlideIndex + 1} / {totalSlides}
            </span>
            <Button variant="default" size="sm" onClick={onNext} disabled={nextDisabled}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
