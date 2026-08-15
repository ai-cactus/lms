'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Document, Page, Thumbnail, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { cn } from '@/lib/utils';

// Self-host the pdf.js worker so it is served same-origin. The CSP allows
// `worker-src 'self' blob:` but not external CDNs, so the previous unpkg URL was
// blocked. `new URL(..., import.meta.url)` lets the bundler emit the worker as a
// same-origin static chunk (react-pdf's documented bundler setup).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const THUMBNAIL_WIDTH = 50;

// react-pdf wraps its own loading/error nodes in a `.react-pdf__message` div that
// would otherwise be auto-placed into the narrow thumbnail column.
const MESSAGE_PLACEMENT = '[&_.react-pdf__message]:col-start-2 [&_.react-pdf__message]:row-start-2';

interface PdfViewerProps {
  fileUrl: string;
  /** Rendered above the document, in the column to the right of the thumbnail rail. */
  meta?: ReactNode;
}

export default function PdfViewer({ fileUrl, meta }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>();
  const [activePage, setActivePage] = useState<number>(1);
  const [contentWidth, setContentWidth] = useState<number>(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
    pageRefs.current = new Array(numPages).fill(null);
    setNumPages(numPages);
    setActivePage(1);
  }

  // Pages are rendered at the content box width so the document fills the space
  // left over by the rail and the 64px gutters, and reflows when either changes.
  useEffect(() => {
    const element = measureRef.current;
    if (!element) return;

    setContentWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setContentWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [numPages]);

  // The rail highlights whichever page crosses the middle band of the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !numPages || contentWidth === 0) return;

    const visiblePages = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number(entry.target.getAttribute('data-page-number'));
          if (entry.isIntersecting) {
            visiblePages.add(pageNumber);
          } else {
            visiblePages.delete(pageNumber);
          }
        }
        if (visiblePages.size > 0) {
          setActivePage(Math.min(...visiblePages));
        }
      },
      { root, rootMargin: '-45% 0px -45% 0px' },
    );

    for (const element of pageRefs.current) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [numPages, contentWidth]);

  const scrollToPage = useCallback((pageNumber: number) => {
    setActivePage(pageNumber);
    pageRefs.current[pageNumber - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const pageNumbers = Array.from({ length: numPages ?? 0 }, (_, index) => index + 1);

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 grid-cols-[80px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]',
        MESSAGE_PLACEMENT,
      )}
    >
      {meta && <div className="col-start-2 row-start-1 min-w-0">{meta}</div>}

      <Document
        className="contents"
        file={fileUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={
          <div className="p-12 text-center text-base text-text-secondary">Loading PDF...</div>
        }
        error={
          <div className="p-12 text-center text-base text-error">Failed to load PDF file.</div>
        }
      >
        <nav
          aria-label="Document pages"
          className="col-start-1 row-span-2 row-start-1 flex flex-col items-center gap-3 overflow-y-auto border-r border-[#e5e5e5] bg-white py-3"
        >
          {pageNumbers.map((pageNumber) => (
            <div
              key={pageNumber}
              aria-current={pageNumber === activePage ? 'page' : undefined}
              className={cn(
                'overflow-hidden rounded-[6px] border bg-white transition-colors',
                pageNumber === activePage ? 'border-primary' : 'border-[#dfe1e6]',
              )}
            >
              <Thumbnail
                pageNumber={pageNumber}
                width={THUMBNAIL_WIDTH}
                loading={null}
                onItemClick={({ pageNumber }) => scrollToPage(pageNumber)}
              />
            </div>
          ))}
        </nav>

        <div ref={scrollRef} className="col-start-2 row-start-2 overflow-auto px-[64px] py-[64px]">
          <div ref={measureRef} className="flex flex-col items-center gap-6">
            {contentWidth > 0 &&
              pageNumbers.map((pageNumber) => (
                <div
                  key={pageNumber}
                  data-page-number={pageNumber}
                  ref={(element) => {
                    pageRefs.current[pageNumber - 1] = element;
                  }}
                >
                  <Page
                    pageNumber={pageNumber}
                    width={contentWidth}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                  />
                </div>
              ))}
          </div>
        </div>
      </Document>
    </div>
  );
}
