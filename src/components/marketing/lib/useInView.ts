'use client';

import { useEffect, useRef, useState } from 'react';

type Options = {
  /** 0–1 portion of the element that must be visible to trigger. */
  threshold?: number;
  /** Margin around the root; negative bottom fires just before fully in view. */
  rootMargin?: string;
};

/**
 * One-shot scroll-into-view detector built on IntersectionObserver.
 * Returns a ref to attach and a boolean that flips to true once (and stays true).
 * Falls back to `true` immediately when IntersectionObserver is unavailable,
 * so content is never left hidden.
 */
export function useInView<T extends HTMLElement = HTMLElement>({
  threshold = 0.15,
  rootMargin = '0px 0px -8% 0px',
}: Options = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Fallback when IntersectionObserver is unavailable (SSR/old browsers): reveal content immediately so it is never left hidden.
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return { ref, inView };
}
