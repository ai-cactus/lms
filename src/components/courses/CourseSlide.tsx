'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import styles from './CoursePlayer.module.css';
import { sanitizeHtml } from '@/lib/sanitize';
import { splitSlideContent, SlidePage } from '@/lib/slide-splitter';

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
  className?: string;
}

export default function CourseSlide({
  lesson,
  onNext,
  onPrev,
  isFirst,
  isLast,
  className = '',
}: CourseSlideProps) {
  const slideRef = useRef<HTMLDivElement>(null);

  // Split the lesson content into bite-sized pages once per lesson change
  const pages = useMemo<SlidePage[]>(() => {
    const cleaned = (lesson.content || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/<br\s*\/?>/gi, '</p><p>')
      .replace(/\s+/g, ' ');
    return splitSlideContent(cleaned);
  }, [lesson.content]);

  const [pageIndex, setPageIndex] = useState(0);

  // Reset pageIndex during render when the lesson changes
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
      onNext(); // advance to next module
    }
  }, [isLastPage, onNext]);

  const goPrev = useCallback(() => {
    if (!isFirstPage) {
      setPageIndex((p) => p - 1);
    } else {
      onPrev(); // go back to previous module
    }
  }, [isFirstPage, onPrev]);

  // Keyboard navigation
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

  // Focus management for accessibility
  useEffect(() => {
    if (slideRef.current) slideRef.current.focus();
  }, [lesson.moduleIndex, pageIndex]);

  const currentPage = pages[pageIndex] ?? { heading: '', html: '' };

  // Whether the prev/next nav buttons should be visibly disabled
  const prevDisabled = isFirstPage && isFirst;
  const nextDisabled = isLastPage && isLast;

  return (
    <div
      className={`${styles.slideStage} ${styles.fadeEnter} ${className}`}
      ref={slideRef}
      tabIndex={-1}
      style={{ outline: 'none' }}
    >
      {/* ── Left nav ─────────────────────────────── */}
      <button
        className={`${styles.navBtn} ${styles.navPrev}`}
        onClick={goPrev}
        disabled={prevDisabled}
        aria-label="Previous"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* ── Slide card ───────────────────────────── */}
      <div className={styles.slideCard}>
        <div className={styles.slideAccent} />
        <div className={styles.slideInner}>
          {/* Module & page meta */}
          <div className={styles.slideMeta}>
            <span className={styles.slideModuleLabel}>Module {lesson.moduleIndex + 1}</span>
            <span className={styles.slideCounter}>
              {lesson.moduleIndex + 1} / {lesson.totalModules}
            </span>
          </div>

          {/* Module title (always shown) */}
          <h2 className={styles.slideTitle}>
            {lesson.title?.replace(/^Module\s+\d+[:.]?\s*/i, '')}
          </h2>

          {/* Section heading from the split content, when present */}
          {currentPage.heading && (
            <h3 className={styles.slideSectionHeading}>{currentPage.heading}</h3>
          )}

          <div className={styles.slideDivider} />

          {/* Page body */}
          <div
            className={styles.slideBody}
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(currentPage.html),
            }}
          />
        </div>

        {/* ── Pagination dots ───────────────────── */}
        {totalPages > 1 && (
          <div
            className={styles.slidePagination}
            aria-label={`Page ${pageIndex + 1} of ${totalPages}`}
          >
            {pages.map((_, i) => (
              <button
                key={i}
                className={`${styles.slideDot} ${i === pageIndex ? styles.slideDotActive : ''}`}
                onClick={() => setPageIndex(i)}
                aria-label={`Go to page ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Right nav ────────────────────────────── */}
      <button
        className={`${styles.navBtn} ${styles.navNext}`}
        onClick={goNext}
        disabled={nextDisabled}
        aria-label="Next"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
