'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, Lightbulb } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { sanitizeHtml } from '@/lib/sanitize';
import { RenderableModule } from '@/types/course';

import ReviewEditButton from './ReviewEditButton';
import {
  REVIEW_STEP_SUBTITLE,
  REVIEW_STEP_TITLE,
  estimateReadMinutes,
  reviewProseClass,
  withHeadingAnchors,
} from './reviewContent';
import {
  wizardSubtitleClass,
  wizardTitleClass,
} from '@/components/dashboard/courses/steps/wizardFormClasses';

interface WizardReviewArticleProps {
  courseTitle: string;
  courseDescription: string;
  /** Chosen on step 1; omitted when the category name could not be resolved. */
  categoryName?: string;
  lessons: RenderableModule[];
  activeIndex: number;
  onSelectLesson: (index: number) => void;
  onViewSlides: () => void;
  lastUpdatedLabel: string;
  /** Training document the active lesson's module was generated from. */
  sourceDocumentName?: string;
  /**
   * Extract of that document. Only available for a course generated in this
   * session — a resumed draft carries the merged text, which cannot be split
   * back per module, so the Sources card then shows the file alone.
   */
  sourceExcerpt?: string;
}

type RailTab = 'contents' | 'sources';

const railTabClass = (isActive: boolean) =>
  `text-base font-bold transition-colors ${
    isActive ? 'text-foreground' : 'text-text-tertiary hover:text-text-secondary'
  }`;

export default function WizardReviewArticle({
  courseTitle,
  courseDescription,
  categoryName,
  lessons,
  activeIndex,
  onSelectLesson,
  onViewSlides,
  lastUpdatedLabel,
  sourceDocumentName,
  sourceExcerpt,
}: WizardReviewArticleProps) {
  const [railTab, setRailTab] = useState<RailTab>('contents');
  const [visitedHeadingId, setVisitedHeadingId] = useState<string | null>(null);

  const lesson = lessons[activeIndex];
  const lessonTitleId = `lesson-${activeIndex}-title`;

  const { html, headings } = useMemo(() => {
    const anchored = withHeadingAnchors(
      sanitizeHtml(lesson?.content || ''),
      `lesson-${activeIndex}`,
    );
    return {
      html: anchored.html,
      // The lesson's own section heading opens the outline, so a lesson whose
      // body carries no sub-headings still has a usable Table of Content.
      headings: [
        { id: lessonTitleId, text: lesson?.title || 'Untitled Section' },
        ...anchored.headings,
      ],
    };
  }, [lesson?.content, lesson?.title, activeIndex, lessonTitleId]);

  // Highlight whichever heading last crossed the top band of the viewport.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const elements = headings
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const firstVisible = headings.find(({ id }) => visible.has(id));
        if (firstVisible) setVisitedHeadingId(firstVisible.id);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [headings]);

  // Derived rather than reset in an effect, so switching lessons falls back to
  // the new lesson's first heading without an extra render.
  const activeHeadingId =
    visitedHeadingId && headings.some(({ id }) => id === visitedHeadingId)
      ? visitedHeadingId
      : headings[0]?.id;

  const handleHeadingClick = (id: string) => {
    setVisitedHeadingId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const readMinutes = estimateReadMinutes(lesson?.content || '');
  const isFirst = activeIndex <= 0;
  const isLast = activeIndex >= lessons.length - 1;

  return (
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <div className="flex flex-col items-center gap-3">
        <h2 className={wizardTitleClass}>{REVIEW_STEP_TITLE}</h2>
        <p className={`${wizardSubtitleClass} max-w-[720px]`}>{REVIEW_STEP_SUBTITLE}</p>
      </div>

      <div className="flex w-full flex-col items-start gap-8 lg:flex-row lg:gap-11">
        <article className="flex min-w-0 flex-1 flex-col">
          {categoryName && (
            <span className="mb-4 w-fit rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
              {categoryName}
            </span>
          )}

          <h1 className="text-[26px] font-bold leading-[1.25] tracking-[-0.02em] text-foreground md:text-[32px]">
            {courseTitle}
          </h1>

          {courseDescription && (
            <p className="mt-3 max-w-[640px] text-[15px] leading-[1.6] text-text-secondary">
              {courseDescription}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-dashed border-border py-3 text-[13px] text-text-secondary">
            <CalendarDays className="size-4" aria-hidden="true" />
            <span>Last update: {lastUpdatedLabel}</span>
            <span aria-hidden="true">•</span>
            <Clock className="size-4" aria-hidden="true" />
            <span>{readMinutes} min read</span>
          </div>

          <h2 id={lessonTitleId} className="mt-6 text-xl font-bold text-foreground md:text-[22px]">
            {lesson?.title || 'Untitled Section'}
          </h2>
          <div
            className={reviewProseClass}
            // Already sanitised: `html` is sanitizeHtml(lesson.content) run through
            // withHeadingAnchors above. It must NOT be re-sanitised here — the
            // allowlist has no `id`, so a second pass would strip the anchors the
            // outline scrolls to. Suppressed at the call site rather than disabling
            // the rule, so a future UNSANITISED sink is still caught.
            // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {lesson?.keyPoints && lesson.keyPoints.length > 0 && (
            <div className="mt-6 flex gap-3 rounded-[10px] bg-background-secondary px-4 py-3.5">
              <Lightbulb className="mt-0.5 size-[18px] shrink-0 text-success" aria-hidden="true" />
              <div className="flex flex-col gap-1 text-[13px] leading-[1.6] text-text-secondary">
                <span className="font-semibold text-foreground">Key Points</span>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {lesson.keyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-4">
            <Button
              variant="outline"
              size="sm"
              disabled={isFirst}
              onClick={() => onSelectLesson(activeIndex - 1)}
              className="h-9 rounded-sm border border-border px-3 text-[13px] font-medium text-text-secondary"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous Lesson
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isLast}
              onClick={() => onSelectLesson(activeIndex + 1)}
              className="h-9 rounded-sm border border-border px-3 text-[13px] font-medium text-text-secondary"
            >
              Next Lesson
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </article>

        <aside className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-6 lg:w-[356px]">
          <ReviewEditButton />
          <Button
            variant="default"
            onClick={onViewSlides}
            className="h-12 w-full rounded-[10px] text-[15px] font-semibold"
          >
            View as Slides
          </Button>

          <div className="mt-2 flex max-h-[60vh] flex-col rounded-md border border-border bg-background">
            <div className="flex items-center gap-4 border-b border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setRailTab('contents')}
                aria-pressed={railTab === 'contents'}
                className={railTabClass(railTab === 'contents')}
              >
                Table of Content
              </button>
              <button
                type="button"
                onClick={() => setRailTab('sources')}
                aria-pressed={railTab === 'sources'}
                className={railTabClass(railTab === 'sources')}
              >
                Sources
              </button>
            </div>

            {railTab === 'contents' ? (
              <nav aria-label="Table of Content" className="min-h-0 overflow-y-auto px-5 py-4">
                <ul className="flex flex-col gap-3">
                  {headings.map((heading) => (
                    <li key={heading.id}>
                      <button
                        type="button"
                        onClick={() => handleHeadingClick(heading.id)}
                        aria-current={heading.id === activeHeadingId ? 'true' : undefined}
                        className={`block w-full truncate text-left text-[15px] transition-colors ${
                          heading.id === activeHeadingId
                            ? 'font-semibold text-primary'
                            : 'text-text-secondary hover:text-foreground'
                        }`}
                      >
                        {heading.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : (
              <div className="flex min-h-0 flex-col gap-3 px-5 py-4">
                {sourceDocumentName ? (
                  <span className="flex w-fit max-w-full items-center gap-2 rounded-full bg-primary/10 py-1.5 pl-1.5 pr-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary">
                      <FileText className="size-3.5 text-primary-foreground" aria-hidden="true" />
                    </span>
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {sourceDocumentName}
                    </span>
                  </span>
                ) : (
                  <p className="text-[13px] text-text-secondary">
                    No source document is linked to this lesson.
                  </p>
                )}

                {sourceExcerpt && (
                  <p className="min-h-0 overflow-y-auto whitespace-pre-wrap text-[13px] leading-[1.7] text-text-secondary">
                    {sourceExcerpt}
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
