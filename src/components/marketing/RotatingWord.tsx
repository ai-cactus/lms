'use client';

import { useEffect, useState } from 'react';

type RotatingWordProps = {
  words: string[];
  /** ms per character while typing */
  typeSpeed?: number;
  /** ms per character while deleting */
  deleteSpeed?: number;
  /** ms to hold a fully-typed word before deleting */
  holdTime?: number;
};

/**
 * Types each word out character-by-character, holds, deletes, then types the
 * next — a classic typewriter, with a blinking caret at the insertion point.
 * The slot auto-sizes to the current text so the centered headline stays
 * balanced (no left-shift). Respects reduced motion: shows the first word
 * fully typed and static.
 */
export function RotatingWord({
  words,
  typeSpeed = 70,
  deleteSpeed = 38,
  holdTime = 1600,
}: RotatingWordProps) {
  const [index, setIndex] = useState(0);
  const [display, setDisplay] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync with the prefers-reduced-motion media query (external system) on mount.
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reduced-motion path: render the first word fully typed and static.
      setDisplay(words[0]);
      return;
    }
    const full = words[index];
    let timeout: ReturnType<typeof setTimeout>;

    if (!deleting && display === full) {
      // Fully typed — hold, then start deleting.
      timeout = setTimeout(() => setDeleting(true), holdTime);
    } else if (deleting && display === '') {
      // Fully deleted — advance to the next word and type it.
      setDeleting(false);
      setIndex((i) => (i + 1) % words.length);
    } else {
      const next = deleting ? full.slice(0, display.length - 1) : full.slice(0, display.length + 1);
      timeout = setTimeout(() => setDisplay(next), deleting ? deleteSpeed : typeSpeed);
    }

    return () => clearTimeout(timeout);
  }, [display, deleting, index, reducedMotion, words, typeSpeed, deleteSpeed, holdTime]);

  return (
    <span className="relative inline-flex items-baseline align-baseline">
      <span className="whitespace-nowrap rounded-[0.15em] bg-gradient-to-r from-[#d6dbee]/80 to-[#e8ebf6]/40 px-[0.12em] text-[#1c1917]">
        {display}
      </span>
      {/* Blinking caret at the insertion point */}
      <span
        aria-hidden="true"
        className="ml-[2px] inline-block h-[0.95em] w-[3px] translate-y-[0.08em] rounded-full bg-[#0119df] motion-safe:animate-caret-blink"
      />
    </span>
  );
}
