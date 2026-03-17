import React, { useEffect, useRef } from 'react';
import styles from './CoursePlayer.module.css';

interface CourseArticleProps {
  title: React.ReactNode;
  children: React.ReactNode;
  onProceedToQuiz?: () => void;
  hasQuiz?: boolean;
  className?: string;
  moduleLabel?: string;
  onNext?: () => void;
  onPrev?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export default function CourseArticle({
  title,
  children,
  onProceedToQuiz,
  hasQuiz,
  className = '',
}: CourseArticleProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus on mount for keyboard scrolling
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, [title]);

  return (
    <div
      className={`${styles.articleStage} ${styles.fadeEnter} ${className}`}
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
              borderTop: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <button
              onClick={onProceedToQuiz}
              style={{
                background: '#4C6EF5',
                color: 'white',
                border: 'none',
                padding: '12px 32px',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Proceed to Quiz
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
