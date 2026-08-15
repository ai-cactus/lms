'use client';

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { sanitizeHtml } from '@/lib/sanitize';
import { splitSlideContent } from '@/lib/slide-splitter';
import { RenderableModule } from '@/types/course';

import ReviewEditButton from './ReviewEditButton';
import { REVIEW_STEP_SUBTITLE, REVIEW_STEP_TITLE, htmlToPlainText } from './reviewContent';

interface WizardReviewSlidesProps {
  lessons: RenderableModule[];
  activeIndex: number;
  onSelectLesson: (index: number) => void;
  onViewNotes: () => void;
}

interface DeckSlide {
  key: string;
  heading: string;
  html: string;
  excerpt: string;
  lessonIndex: number;
}

/** Characters of body text shown on a thumbnail before it is clipped. */
const THUMBNAIL_EXCERPT_LENGTH = 220;

const slideBodyClass = [
  'text-sm leading-[1.7] text-[#424242]',
  '[&_p]:my-3',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-[#0d0d12]',
  '[&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-bold [&_h4]:text-[#0d0d12]',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:mb-1.5',
  '[&_strong]:font-semibold [&_strong]:text-[#0d0d12]',
].join(' ');

export default function WizardReviewSlides({
  lessons,
  activeIndex,
  onSelectLesson,
  onViewNotes,
}: WizardReviewSlidesProps) {
  // The rail shows the whole course deck, as in the design, so every slide
  // carries the lesson it belongs to and selecting one keeps the notes view in
  // sync.
  const deck = useMemo<DeckSlide[]>(
    () =>
      lessons.flatMap((lesson, lessonIndex) =>
        splitSlideContent(lesson.slideContent || lesson.content || '').map((page, pageIndex) => {
          const html = sanitizeHtml(page.html);
          return {
            key: `${lesson.id}-${pageIndex}`,
            heading: page.heading || lesson.title,
            html,
            excerpt: htmlToPlainText(html).slice(0, THUMBNAIL_EXCERPT_LENGTH),
            lessonIndex,
          };
        }),
      ),
    [lessons],
  );

  // Only one of the two review views is mounted at a time, so opening the deck
  // from the notes view lands on the lesson that was being read.
  const [activeSlide, setActiveSlide] = useState(() =>
    Math.max(
      deck.findIndex((slide) => slide.lessonIndex === activeIndex),
      0,
    ),
  );

  const goToSlide = (index: number) => {
    const slide = deck[index];
    if (!slide) return;
    setActiveSlide(index);
    if (slide.lessonIndex !== activeIndex) onSelectLesson(slide.lessonIndex);
  };

  const current = deck[activeSlide];

  return (
    <div className="flex w-full flex-col gap-8 md:gap-10">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <h2 className="text-[26px] font-bold leading-[1.33] tracking-[-0.02em] text-[#383838] md:text-[32px]">
            {REVIEW_STEP_TITLE}
          </h2>
          <p className="max-w-[600px] text-[15px] font-medium leading-[1.44] text-[#424242] md:text-base">
            {REVIEW_STEP_SUBTITLE}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 md:w-[300px]">
          <ReviewEditButton />
          <Button
            variant="default"
            onClick={onViewNotes}
            className="h-12 w-full rounded-[10px] text-[15px] font-semibold"
          >
            View as Notes
          </Button>
        </div>
      </div>

      <div className="flex w-full flex-col gap-5 lg:flex-row lg:gap-6">
        <nav
          aria-label="Slides"
          className="flex max-h-[220px] w-full shrink-0 gap-3 overflow-x-auto lg:max-h-[520px] lg:w-[120px] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto"
        >
          {deck.map((slide, index) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => goToSlide(index)}
              aria-label={`Slide ${index + 1}: ${slide.heading}`}
              aria-current={index === activeSlide ? 'true' : undefined}
              className={`flex aspect-[4/3] w-[110px] shrink-0 flex-col overflow-hidden rounded-[4px] border bg-white text-left transition-colors ${
                index === activeSlide
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-[#e5e7ea] hover:border-[#c8ccd4]'
              }`}
            >
              <span className="truncate bg-primary px-1.5 py-1 text-[6px] font-bold text-primary-foreground">
                {slide.heading}
              </span>
              <span className="line-clamp-6 px-1.5 py-1 text-[5px] leading-[1.6] text-[#666d80]">
                {slide.excerpt}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous slide"
            disabled={activeSlide <= 0}
            onClick={() => goToSlide(activeSlide - 1)}
            className="shrink-0 text-[#9ca3af]"
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </Button>

          <div className="flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-[#e5e7ea] bg-white">
            <div className="bg-primary px-6 py-5 text-lg font-bold text-primary-foreground md:text-2xl">
              {current?.heading || 'Untitled Slide'}
            </div>
            <div
              className={`flex-1 overflow-y-auto px-6 py-6 md:px-10 ${slideBodyClass}`}
              dangerouslySetInnerHTML={{ __html: current?.html || '' }}
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Next slide"
            disabled={activeSlide >= deck.length - 1}
            onClick={() => goToSlide(activeSlide + 1)}
            className="shrink-0 text-[#9ca3af]"
          >
            <ChevronRight className="size-6" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
