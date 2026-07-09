import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface CourseRailProps {
  lessons: { id?: string; title: string }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  unlockedIndex?: number;
  quiz?: { id: string; title: string };
  className?: string;
  onExitClick?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function CourseRail({
  lessons,
  activeIndex,
  onSelect,
  unlockedIndex = 9999, // Default to all unlocked
  quiz,
  className = '',
  onExitClick,
  disableNav = false,
  isOpen = false,
  onClose,
}: CourseRailProps & { disableNav?: boolean }) {
  // Helper to strip "Module X: " prefix for cleaner thumbnails
  const getShortTitle = (title: string) => {
    return title.replace(/^Module\s+\d+[:.]?\s*/i, '').trim() || 'Untitled';
  };

  const handleSelect = (index: number) => {
    onSelect(index);
    onClose?.();
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-[55] bg-black/40 md:hidden" onClick={onClose} />}

      <nav
        className={`fixed right-0 top-0 z-[60] flex h-full w-40 flex-col items-center gap-3 overflow-y-auto overflow-x-hidden border-l border-border-default bg-background px-3 py-6 shadow-[-4px_0_12px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] md:static md:w-[140px] md:translate-x-0 md:border-[#e8e6e1] md:shadow-none ${isOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'} ${className}`}
      >
        {onExitClick && (
          <div className="mb-8 flex w-full items-center justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onExitClick}
              disabled={disableNav}
              className="flex items-center gap-1.5 font-semibold"
            >
              <X width={14} height={14} />
              Exit
            </Button>
          </div>
        )}

        {lessons.map((lesson, i) => {
          const isLocked = i > unlockedIndex;
          const isActive = i === activeIndex;
          const isDone = i < activeIndex && !isLocked;
          const isDisabled = isLocked || disableNav;

          return (
            <button
              key={i}
              className={`group relative flex min-h-[70px] w-full flex-col items-center justify-start gap-1.5 overflow-hidden rounded-xl border p-2 text-center transition-all ${
                isActive
                  ? 'border-primary shadow-[0_0_0_1px_var(--primary),0_4px_12px_rgba(0,0,0,0.08)]'
                  : 'border-[#e5e7eb] hover:border-[#d1d5db] hover:-translate-y-px hover:shadow-[0_4px_6px_rgba(0,0,0,0.05)]'
              } ${isDone ? 'bg-[#f9fafb] opacity-80' : 'bg-white'} ${
                isLocked ? 'cursor-not-allowed border-dashed bg-[#f3f4f6] opacity-50' : ''
              } ${disableNav ? 'cursor-not-allowed opacity-50' : ''}`}
              onClick={() => !isDisabled && handleSelect(i)}
              disabled={isDisabled}
              title={lesson.title}
            >
              <div
                className={`h-[3px] shrink-0 rounded-sm ${isActive ? 'w-10 bg-primary' : 'w-6 bg-[#e5e7eb]'}`}
              />
              <span
                className={`line-clamp-3 w-full text-[10px] font-semibold leading-[1.3] ${isActive ? 'text-[#1a1a1a] font-bold' : 'text-[#6b7280]'}`}
              >
                {isLocked ? '🔒' : getShortTitle(lesson.title)}
              </span>
            </button>
          );
        })}

        {quiz && (
          <button
            className={`group relative flex min-h-[50px] w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border p-2 text-center transition-all ${
              activeIndex === lessons.length
                ? 'border-[#4f46e5] bg-[#e0e7ff] shadow-[0_0_0_1px_#4f46e5]'
                : 'border-[#e0e7ff] bg-[#eef2ff]'
            } ${lessons.length > unlockedIndex || disableNav ? 'cursor-not-allowed border-dashed bg-[#f3f4f6] opacity-50' : ''}`}
            onClick={() =>
              !disableNav && lessons.length <= unlockedIndex && handleSelect(lessons.length)
            }
            disabled={lessons.length > unlockedIndex || disableNav}
            title={quiz.title || 'Quiz'}
          >
            <span className="line-clamp-3 w-full text-[13px] font-semibold leading-[1.3] text-[#4338ca]">
              {lessons.length <= unlockedIndex ? 'QUIZ' : '🔒'}
            </span>
          </button>
        )}
      </nav>
    </>
  );
}
