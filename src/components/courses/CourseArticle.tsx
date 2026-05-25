import React, { useEffect, useRef } from 'react';
import styles from './CoursePlayer.module.css';
import { Button } from '@/components/ui';

interface CourseArticleProps {
  title: React.ReactNode;
  children: React.ReactNode;
  lessons?: { id?: string; title: string }[];
  activeIndex?: number;
  onSelectModule?: (index: number) => void;
  onToggleView?: () => void;
  onProceedToQuiz?: () => void;
  hasQuiz?: boolean;
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
    <div className={`${styles.articleContainer} ${className}`}>
      {/* Topbar */}
      {hasFullLayout && (
        <div className={styles.articleTopbar}>
          <span className={styles.articleTopbarTitle}>
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
      <div className={styles.articleBody}>
        {/* Main article content */}
        <div
          className={styles.articleStage}
          ref={containerRef}
          tabIndex={0}
          style={{ outline: 'none' }}
        >
          <div className={styles.articlePaper}>
            <div className={styles.articleHeader}>
              {typeof title === 'string' ? <h1 className={styles.articleTitle}>{title}</h1> : title}
            </div>

            <div className={styles.articleDivider} />

            <div className={styles.articleContent}>{children}</div>

            {hasQuiz && onProceedToQuiz && (
              <div
                style={{
                  marginTop: '48px',
                  paddingTop: '32px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <Button variant="primary" onClick={onProceedToQuiz}>
                  Proceed to Quiz
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right-side Table of Contents — only when full layout is active */}
        {hasFullLayout && (
          <div className={styles.articleToc}>
            <div className={styles.articleTocTitle}>Table of Contents</div>
            <div className={styles.articleTocList}>
              {lessons.map((lesson, i) => (
                <button
                  key={lesson.id || i}
                  className={`${styles.articleTocItem} ${i === activeIndex ? styles.articleTocItemActive : ''}`}
                  onClick={() => onSelectModule(i)}
                >
                  <span className={styles.articleTocNumber}>{i + 1}</span>
                  <span className={styles.articleTocLabel}>{getShortTitle(lesson.title)}</span>
                </button>
              ))}

              {hasQuiz && (
                <div className={styles.articleTocQuiz}>
                  <button
                    className={`${styles.articleTocItem} ${activeIndex === lessons.length ? styles.articleTocItemActive : ''}`}
                    onClick={() => onSelectModule(lessons.length)}
                  >
                    <span className={styles.articleTocNumber}>Q</span>
                    <span className={styles.articleTocLabel}>Quiz</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom navigation — only when full layout is active */}
      {hasFullLayout && (onPrev || onNext) && (
        <div className={styles.articleBottomNav}>
          <Button variant="outline" size="sm" onClick={onPrev} disabled={isFirst}>
            Previous
          </Button>
          <Button variant="primary" size="sm" onClick={onNext} disabled={isLast}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
