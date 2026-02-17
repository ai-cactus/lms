'use client';

import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';

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
    style
}: SlideContentFitterProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [fontSize, setFontSize] = useState(maxFontSize);
    // Track if we are currently adjusting to prevent flicker
    const [isAdjusting, setIsAdjusting] = useState(true);

    // Reset to max when content changes
    useLayoutEffect(() => {
        setFontSize(maxFontSize);
        setIsAdjusting(true);
    }, [content, maxFontSize]);

    useLayoutEffect(() => {
        const adjustFontSize = () => {
            const el = containerRef.current;
            if (!el) return;

            // Simple iterative binary-ish search or step-down would work.
            // Since we start successfully at max, we likely need to shrink.

            // Check if overflowing
            if (el.scrollHeight > el.clientHeight) {
                // If font is already min, we can't do anything
                if (fontSize <= minFontSize) {
                    setIsAdjusting(false);
                    return;
                }

                // Reduce font size
                // We use a state update here which triggers re-render, 
                // but useLayoutEffect runs before paint, so it might be efficient enough if steps are small.
                // However, doing this loop synchronously is better for layout thrashing prevention?
                // We can't change state in a loop easily without effects. 
                // Let's try a binary search approach if possible, but we need the refs.

                // Better approach:
                // We are in useLayoutEffect. We can modify the style directly to test, then set state final.
                // But we want to impact the render.

                let currentSize = fontSize;
                while (el.scrollHeight > el.clientHeight && currentSize > minFontSize) {
                    currentSize -= 0.5;
                    el.style.fontSize = `${currentSize}px`;
                }

                // If we shrunk, update state to match (or just keep the direct style?)
                // Updating state is cleaner for React.
                if (currentSize !== fontSize) {
                    setFontSize(currentSize);
                }
            } else {
                // Logic to GROW if too small? 
                // If we started at max (reset above), we only shrink.
                // So we don't need to grow unless window resized larger.

                // Handle Resize: If we are smaller than max, and have space, grow?
                // This is harder because adding size might overflow immediately.
                // Let's stick to "shrink to fit" from max for now which covers "fill the card".
            }

            setIsAdjusting(false);
        };

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
            setFontSize(currentSize);
            setIsAdjusting(false);
        }

    }, [content, maxFontSize, minFontSize, isAdjusting]); // Dependencies

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
                overflowY: 'auto' // Fallback
            }}
            dangerouslySetInnerHTML={{ __html: content }}
        />
    );
}
