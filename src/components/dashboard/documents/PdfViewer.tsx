'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button } from '@/components/ui/button';

// Configure the worker using unpkg (recommended by react-pdf docs for simplicity)
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  fileUrl: string;
}

export default function PdfViewer({ fileUrl }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
    setNumPages(numPages);
    setPageNumber(1);
  }

  return (
    <div className="flex w-full flex-col items-center overflow-hidden rounded-lg border border-border bg-white">
      <div className="flex w-full items-center justify-between border-b border-border bg-bg-secondary px-6 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageNumber((prev) => Math.max(prev - 1, 1))}
            disabled={pageNumber <= 1}
          >
            &larr; Prev
          </Button>
          <span className="min-w-[100px] text-center text-sm font-medium text-text-secondary">
            Page {pageNumber} of {numPages || '--'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageNumber((prev) => Math.min(prev + 1, numPages || 1))}
            disabled={pageNumber >= (numPages || 1)}
          >
            Next &rarr;
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          >
            -
          </Button>
          <span className="min-w-[40px] text-center text-sm font-medium">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale((s) => Math.min(3.0, s + 0.25))}
          >
            +
          </Button>
        </div>
      </div>

      <div className="flex max-h-[800px] w-full justify-center overflow-auto bg-[#f1f5f9] p-6">
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="p-12 text-center text-base text-text-secondary">Loading PDF...</div>
          }
          error={
            <div className="p-12 text-center text-base text-error">Failed to load PDF file.</div>
          }
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            className="mb-6 shadow-md"
          />
        </Document>
      </div>
    </div>
  );
}
