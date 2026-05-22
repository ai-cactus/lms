'use client';

import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';

interface SlideContentFitterProps {
  content: string;
  className?: string;
  minFontSize?: number;
  maxFontSize?: number;
  style?: React.CSSProperties;
}

export default function SlideContentFitter({
  content,
  className,
  minFontSize = 12,
  maxFontSize = 24, // Start large to "fill"
  style,
}: SlideContentFitterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  // Track if we are currently adjusting to prevent flicker
  const [isAdjusting, setIsAdjusting] = useState(true);

  // Reset to max when content changes
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset state based on content change
    setFontSize(maxFontSize);
    setIsAdjusting(true);
  }, [content, maxFontSize]);

  useLayoutEffect(() => {
    // We can run the adjustment loop directly on the element
    const el = containerRef.current;
    if (el && isAdjusting) {
      let currentSize = maxFontSize;
      el.style.fontSize = `${currentSize}px`;

      // Loop to shrink
      // Safety counter
      let iterations = 0;
      while (el.scrollHeight > el.clientHeight && currentSize > minFontSize && iterations < 100) {
        currentSize -= 1; // Step by 1px for speed
        el.style.fontSize = `${currentSize}px`;
        iterations++;
      }

      // Finalize
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Finalize after layout measurement
      setFontSize(currentSize);
      setIsAdjusting(false);
    }
  }, [content, maxFontSize, minFontSize, isAdjusting, fontSize]); // Dependencies

  // Handle Window Resize
  useEffect(() => {
    const handleResize = () => {
      setIsAdjusting(true); // Trigger re-calculation
      setFontSize(maxFontSize); // Reset to try max again
    };

    // Debounce?
    let timeoutId: NodeJS.Timeout;
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleResize, 200);
    };

    window.addEventListener('resize', debouncedResize);
    return () => {
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(timeoutId);
    };
  }, [maxFontSize]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...style,
        fontSize: `${fontSize}px`,
        visibility: isAdjusting ? 'hidden' : 'visible', // Hide while calculating to prevent flash
        overflowY: 'auto', // Fallback
      }}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
    />
  );
}
