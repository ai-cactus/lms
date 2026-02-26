import React from 'react';
import styles from './CoursePlayer.module.css';
import Logo from '@/components/ui/Logo';

export interface CourseRailProps {
    lessons: { id?: string; title: string }[];
    activeIndex: number;
    onSelect: (index: number) => void;
    unlockedIndex?: number;
    quiz?: { id: string; title: string };
    className?: string;
    onExitClick?: () => void;
}

export default function CourseRail({
    lessons,
    activeIndex,
    onSelect,
    unlockedIndex = 9999, // Default to all unlocked
    quiz,
    className = '',
    onExitClick,
    disableNav = false
}: CourseRailProps & { disableNav?: boolean }) {

    // Helper to strip "Module X: " prefix for cleaner thumbnails
    const getShortTitle = (title: string) => {
        return title.replace(/^Module\s+\d+[:.]?\s*/i, '').trim() || 'Untitled';
    };

    return (
        <nav className={`${styles.rail} ${className}`}>
            <div className={styles.railLogo}>
                <button
                    onClick={onExitClick}
                    style={{
                        background: 'transparent',
                        border: '1px solid #E5E7EB',
                        borderRadius: '6px',
                        padding: '6px 16px',
                        color: '#4B5563',
                        cursor: disableNav ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        opacity: disableNav ? 0.5 : 1
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    Exit
                </button>
            </div>

            {lessons.map((lesson, i) => {
                const isLocked = i > unlockedIndex;
                const isActive = i === activeIndex;
                const isDone = i < activeIndex && !isLocked;
                const isDisabled = isLocked || disableNav;

                return (
                    <button
                        key={i}
                        className={`${styles.modThumb} ${isActive ? styles.modThumbActive : ''} ${isDone ? styles.modThumbDone : ''} ${isDisabled ? styles.modThumbLocked : ''}`}
                        onClick={() => !isDisabled && onSelect(i)}
                        disabled={isDisabled}
                        title={lesson.title}
                        style={disableNav ? { cursor: 'not-allowed', opacity: 0.5 } : {}}
                    >
                        <div className={styles.modThumbAccent} />
                        <span className={styles.modThumbTitle}>
                            {isLocked ? '🔒' : getShortTitle(lesson.title)}
                        </span>
                    </button>
                );
            })}

            {quiz && (
                <button
                    className={`${styles.modThumb} ${styles.modThumbQuiz} ${activeIndex === lessons.length ? styles.modThumbQuizActive : ''} ${lessons.length > unlockedIndex || disableNav ? styles.modThumbLocked : ''}`}
                    onClick={() => !disableNav && lessons.length <= unlockedIndex && onSelect(lessons.length)}
                    disabled={lessons.length > unlockedIndex || disableNav}
                    title={quiz.title || "Quiz"}
                    style={disableNav ? { cursor: 'not-allowed', opacity: 0.5 } : {}}
                >
                    <span className={styles.modThumbTitle} style={{ fontSize: 13 }}>
                        {lessons.length <= unlockedIndex ? 'QUIZ' : '🔒'}
                    </span>
                </button>
            )}
        </nav>
    );
}
