'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import styles from './CoursePlayer.module.css';
import { sanitizeHtml } from '@/lib/sanitize';
import { splitSlideContent, SlidePage } from '@/lib/slide-splitter';
import { Button } from '@/components/ui';

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
    <div
      className={`${styles.slideContainer} ${className}`}
      ref={slideRef}
      tabIndex={-1}
      style={{ outline: 'none' }}
    >
      {/* Topbar */}
      <div className={styles.slideTopbar}>
        <div className={styles.slideTopbarLeft}>
          <span className={styles.slideTopbarTitle}>
            Module {lesson.moduleIndex + 1}: {cleanTitle}
          </span>
          <span className={styles.slideStepIndicator}>
            Slide {pageIndex + 1} of {totalPages}
          </span>
        </div>
        <div className={styles.slideTopbarRight}>
          {onToggleView && (
            <Button variant="ghost" size="sm" onClick={onToggleView}>
              View as Notes
            </Button>
          )}
        </div>
      </div>

      {/* Body: thumbnails + main slide card */}
      <div className={styles.slideBody}>
        {/* Left thumbnail sidebar */}
        <div className={styles.slideThumbnails}>
          {pages.map((page, i) => (
            <button
              key={i}
              className={`${styles.slideThumb} ${i === pageIndex ? styles.slideThumbActive : ''}`}
              onClick={() => setPageIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
            >
              <div className={styles.slideThumbBar} />
              <span className={styles.slideThumbLabel}>{page.heading || `Slide ${i + 1}`}</span>
            </button>
          ))}
        </div>

        {/* Main area */}
        <div className={styles.slideMainArea}>
          {/* Slide card */}
          <div className={styles.slideCard}>
            <div className={styles.slideCardAccent} />
            <div className={styles.slideInner}>
              <div className={styles.slideMeta}>
                <span className={styles.slideModuleLabel}>Module {lesson.moduleIndex + 1}</span>
                <span className={styles.slideCounter}>
                  {lesson.moduleIndex + 1} / {lesson.totalModules}
                </span>
              </div>

              <h2 className={styles.slideTitle}>{cleanTitle}</h2>

              {currentPage.heading && (
                <h3 className={styles.slideSectionHeading}>{currentPage.heading}</h3>
              )}

              <div className={styles.slideDivider} />

              <div
                className={styles.slideContent}
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(currentPage.html),
                }}
              />
            </div>
          </div>

          {/* Bottom navigation */}
          <div className={styles.slideBottomNav}>
            <Button variant="outline" size="sm" onClick={goPrev} disabled={isFirstPage && isFirst}>
              Back
            </Button>
            <span className={styles.slidePageCount}>
              {pageIndex + 1} / {totalPages}
            </span>
            <Button variant="primary" size="sm" onClick={goNext} disabled={isLastPage && isLast}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
