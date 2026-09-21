'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';
import { splitSlideContent, SlidePage } from '@/lib/slide-splitter';
import { Button } from '@/components/ui/button';
import SlideDeckShell from '@/components/courses/SlideDeckShell';
import { learnerSlideContentClass } from '@/components/courses/slide-content-class';

interface CourseSlideProps {
  lesson: {
    title: string;
    content: string;
    moduleIndex: number;
    totalModules: number;
  };
  onNext: () => void;
  onPrev: () => void;
  isFirst: boolean;
  isLast: boolean;
  onToggleView?: () => void;

  className?: string;
}

export default function CourseSlide({
  lesson,
  onNext,
  onPrev,
  isFirst,
  isLast,
  onToggleView,

  className = '',
}: CourseSlideProps) {
  const slideRef = useRef<HTMLDivElement>(null);

  const pages = useMemo<SlidePage[]>(() => {
    const cleaned = (lesson.content || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/<br\s*\/?>/gi, '</p><p>')
      .replace(/\s+/g, ' ');
    return splitSlideContent(cleaned);
  }, [lesson.content]);

  const [pageIndex, setPageIndex] = useState(0);

  const [prevLessonContent, setPrevLessonContent] = useState(lesson.content);
  if (lesson.content !== prevLessonContent) {
    setPrevLessonContent(lesson.content);
    setPageIndex(0);
  }

  const totalPages = pages.length;
  const isFirstPage = pageIndex === 0;
  const isLastPage = pageIndex === totalPages - 1;

  const goNext = useCallback(() => {
    if (!isLastPage) {
      setPageIndex((p) => p + 1);
    } else {
      onNext();
    }
  }, [isLastPage, onNext]);

  const goPrev = useCallback(() => {
    if (!isFirstPage) {
      setPageIndex((p) => p - 1);
    } else {
      onPrev();
    }
  }, [isFirstPage, onPrev]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') {
        if (!isFirstPage || !isFirst) goPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, isFirstPage, isFirst]);

  useEffect(() => {
    if (slideRef.current) slideRef.current.focus();
  }, [lesson.moduleIndex, pageIndex]);

  const currentPage = pages[pageIndex] ?? { heading: '', html: '' };

  const cleanTitle = lesson.title?.replace(/^Module\s+\d+[:.]?\s*/i, '');

  return (
    <SlideDeckShell
      ref={slideRef}
      className={className}
      moduleTitle={cleanTitle}
      moduleIndex={lesson.moduleIndex}
      totalModules={lesson.totalModules}
      slides={pages}
      activeSlideIndex={pageIndex}
      onSelectSlide={setPageIndex}
      slideHeading={currentPage.heading}
      headerActions={
        onToggleView && (
          <Button variant="ghost" size="sm" onClick={onToggleView}>
            View as Notes
          </Button>
        )
      }
      onBack={goPrev}
      onNext={goNext}
      backDisabled={isFirstPage && isFirst}
      nextDisabled={isLastPage && isLast}
    >
      <div
        className={learnerSlideContentClass}
        dangerouslySetInnerHTML={{
          // Sanitised via sanitizeHtml (DOMPurify). Suppressed at the call site rather
          // than disabling the rule, so a future UNSANITISED sink is still caught.
          // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
          __html: sanitizeHtml(currentPage.html),
        }}
      />
    </SlideDeckShell>
  );
}
