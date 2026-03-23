import React, { useEffect, useRef } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import styles from './CoursePlayer.module.css';
import SlideContentFitter from '@/components/ui/SlideContentFitter';
import { sanitizeHtml } from '@/lib/sanitize';

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

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !isLast) {
        onNext();
      } else if (e.key === 'ArrowLeft' && !isFirst) {
        onPrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext, onPrev, isFirst, isLast]);

  // Focus management for accessibility
  useEffect(() => {
    if (slideRef.current) {
      slideRef.current.focus();
    }
  }, [lesson.moduleIndex]);

  return (
    <div
      className={`${styles.slideStage} ${styles.fadeEnter}`}
      ref={slideRef}
      tabIndex={-1}
      style={{ outline: 'none' }}
    >
      <button
        className={`${styles.navBtn} ${styles.navPrev}`}
        onClick={onPrev}
        disabled={isFirst}
        aria-label="Previous Slide"
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

      <div className={styles.slideCard}>
        <div className={styles.slideAccent} />
        <div className={styles.slideInner}>
          <div className={styles.slideMeta}>
            <span className={styles.slideModuleLabel}>Module {lesson.moduleIndex + 1}</span>
            <span className={styles.slideCounter}>
              {lesson.moduleIndex + 1} / {lesson.totalModules}
            </span>
          </div>

          <h2 className={styles.slideTitle}>
            {lesson.title?.replace(/^Module\s+\d+[:.]?\s*/i, '')}
          </h2>

          <div className={styles.slideDivider} />

          <div
            className={styles.slideBody}
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(
                (lesson.content || '')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/<br\s*\/?>/gi, ' ')
                  .replace(/\s+/g, ' '),
              ),
            }}
          />
        </div>
      </div>

      <button
        className={`${styles.navBtn} ${styles.navNext}`}
        onClick={onNext}
        disabled={isLast}
        aria-label="Next Slide"
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
