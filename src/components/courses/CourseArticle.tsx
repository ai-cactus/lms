import React, { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

interface CourseArticleProps {
  title: React.ReactNode;
  children: React.ReactNode;
  lessons?: { id?: string; title: string }[];
  activeIndex?: number;
  onSelectModule?: (index: number) => void;
  onToggleView?: () => void;
  onProceedToQuiz?: () => void;
  hasQuiz?: boolean;
  /** When true, the "Proceed to Quiz" control is disabled (e.g. video watch-gate not met). */
  proceedDisabled?: boolean;
  /** Optional helper hint shown near a disabled "Proceed to Quiz" control. */
  proceedHint?: React.ReactNode;
  onNext?: () => void;
  onPrev?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  className?: string;
}

export default function CourseArticle({
  title,
  children,
  lessons,
  activeIndex = 0,
  onSelectModule,
  onToggleView,
  onProceedToQuiz,
  hasQuiz,
  proceedDisabled = false,
  proceedHint,
  onNext,
  onPrev,
  isFirst,
  isLast,
  className = '',
}: CourseArticleProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, [title]);

  const getShortTitle = (t: string) => t.replace(/^Module\s+\d+[:.]?\s*/i, '').trim() || 'Untitled';

  const hasFullLayout = lessons && onSelectModule;

  return (
    <div className={`flex h-full w-full flex-col bg-background-secondary ${className}`}>
      {/* Topbar */}
      {hasFullLayout && (
        <div className="flex shrink-0 items-center justify-between border-b border-border-default bg-background px-4 py-2.5 md:px-6 md:py-3">
          <span className="text-xs font-semibold text-foreground md:text-sm">
            {typeof title === 'string' ? title : 'Course'}
          </span>
          {onToggleView && (
            <Button variant="ghost" size="sm" onClick={onToggleView}>
              View on Slides
            </Button>
          )}
        </div>
      )}

      {/* Body: content + optional ToC */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main article content */}
        <div
          className="flex-1 overflow-y-auto bg-background-secondary px-4 py-5 outline-none [scroll-behavior:smooth] md:px-8 md:py-10"
          ref={containerRef}
          tabIndex={0}
        >
          <div className="mx-auto mb-[60px] max-w-[800px] md:mb-20">
            <div className="mb-6 md:mb-10">
              {typeof title === 'string' ? (
                <h1 className="text-[22px] font-extrabold leading-[1.15] tracking-[-0.03em] text-foreground sm:text-[26px] md:text-4xl">
                  {title}
                </h1>
              ) : (
                title
              )}
            </div>

            <div className="my-6 h-px bg-border-light md:my-8" />

            <div className="mx-auto max-w-[760px] break-words text-[15px] font-normal leading-[1.7] text-text-secondary [hyphens:none] [text-wrap:pretty] md:text-base md:leading-[1.8] [&_*]:break-words [&_*]:text-left [&_*]:[hyphens:none] [&_blockquote]:my-7 [&_blockquote]:border-l-4 [&_blockquote]:border-border-default [&_blockquote]:pl-5 [&_blockquote]:italic [&_blockquote]:text-text-muted [&_h2]:mb-4 [&_h2]:mt-8 [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:tracking-[-0.02em] [&_h2]:text-foreground md:[&_h2]:mb-5 md:[&_h2]:mt-10 md:[&_h2]:text-[26px] [&_h3]:mb-3.5 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground md:[&_h3]:mt-7 md:[&_h3]:text-xl [&_li]:mb-1.5 [&_ol]:mb-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-6 [&_ul]:mb-5 [&_ul]:list-disc [&_ul]:pl-6">
              {children}
            </div>

            {hasQuiz && onProceedToQuiz && (
              <div className="mt-12 flex flex-col items-center gap-2 border-t border-border-default pt-8">
                <Button variant="default" onClick={onProceedToQuiz} disabled={proceedDisabled}>
                  Proceed to Quiz
                </Button>
                {proceedDisabled && proceedHint && (
                  <p className="text-sm text-text-muted">{proceedHint}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right-side Table of Contents — only when full layout is active */}
        {hasFullLayout && (
          <div className="hidden w-[260px] shrink-0 overflow-y-auto border-l border-border-default bg-background px-4 py-6 md:block">
            <div className="mb-4 border-b border-border-light pb-3 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
              Table of Contents
            </div>
            <div className="flex flex-col gap-0.5">
              {lessons.map((lesson, i) => (
                <button
                  key={lesson.id || i}
                  className={`group flex w-full items-center gap-2.5 rounded-lg border-none px-3 py-2.5 text-left font-[inherit] transition-all hover:bg-background-secondary ${i === activeIndex ? 'bg-[#eef2ff]' : 'bg-transparent'}`}
                  onClick={() => onSelectModule(i)}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all ${i === activeIndex ? 'bg-primary text-white' : 'bg-background-secondary text-text-muted'}`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`line-clamp-2 text-[13px] leading-[1.3] ${i === activeIndex ? 'font-semibold text-foreground' : 'font-medium text-text-secondary'}`}
                  >
                    {getShortTitle(lesson.title)}
                  </span>
                </button>
              ))}

              {hasQuiz && (
                <div className="mt-2 border-t border-border-light pt-3">
                  <button
                    className={`flex w-full items-center gap-2.5 rounded-lg border-none px-3 py-2.5 text-left font-[inherit] transition-all hover:bg-background-secondary ${activeIndex === lessons.length ? 'bg-[#eef2ff]' : 'bg-transparent'}`}
                    onClick={() => onSelectModule(lessons.length)}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all ${activeIndex === lessons.length ? 'bg-primary text-white' : 'bg-background-secondary text-text-muted'}`}
                    >
                      Q
                    </span>
                    <span
                      className={`line-clamp-2 text-[13px] leading-[1.3] ${activeIndex === lessons.length ? 'font-semibold text-foreground' : 'font-medium text-text-secondary'}`}
                    >
                      Quiz
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom navigation — only when full layout is active */}
      {hasFullLayout && (onPrev || onNext) && (
        <div className="flex shrink-0 items-center justify-between border-t border-border-default bg-background px-4 py-3 md:px-8 md:py-4">
          <Button variant="outline" size="sm" onClick={onPrev} disabled={isFirst}>
            Previous
          </Button>
          <Button variant="default" size="sm" onClick={onNext} disabled={isLast}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
