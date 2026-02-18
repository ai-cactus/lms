import React, { useEffect, useRef } from 'react';
import styles from './CoursePlayer.module.css';

interface CourseArticleProps {
    title: React.ReactNode;
    moduleLabel: string;
    children: React.ReactNode;
    onNext: () => void;
    onPrev: () => void;
    isFirst: boolean;
    isLast: boolean;
    className?: string;
}

export default function CourseArticle({
    title,
    moduleLabel,
    children,
    onNext,
    onPrev,
    isFirst,
    isLast,
    className = ''
}: CourseArticleProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Focus on mount for keyboard scrolling
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.focus();
        }
    }, [moduleLabel]); // Re-focus when module changes

    // Keyboard Navigation (Left/Right for Module)
    // Up/Down is handled natively by browser scrolling if container has focus
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only traverse modules if modifier keys aren't pressed
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            // Also ignore if inside contenteditable (ReactQuill)
            if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;

            if (e.key === 'ArrowRight' && !isLast) {
                e.preventDefault();
                onNext();
            } else if (e.key === 'ArrowLeft' && !isFirst) {
                e.preventDefault();
                onPrev();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onNext, onPrev, isFirst, isLast]);

    return (
        <div
            className={`${styles.articleStage} ${styles.fadeEnter}`}
            ref={containerRef}
            tabIndex={0}
            style={{ outline: 'none' }}
        >
            <div className={styles.articlePaper}>
                <div className={styles.articleHeader}>
                    <p className={styles.articleModuleLabel}>{moduleLabel}</p>
                    {typeof title === 'string' ? (
                        <h1 className={styles.articleTitle}>{title}</h1>
                    ) : (
                        title
                    )}
                </div>

                <div className={styles.articleDivider} />

                <div className={styles.articleContent}>
                    {children}
                </div>

                <div className={styles.articleFooter}>
                    <button
                        className={styles.textBtn}
                        onClick={onPrev}
                        disabled={isFirst}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        Previous Module
                    </button>

                    <button
                        className={styles.textBtn}
                        onClick={onNext}
                        disabled={isLast}
                    >
                        Next Module
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
