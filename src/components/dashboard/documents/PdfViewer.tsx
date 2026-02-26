'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import styles from './PdfViewer.module.css';

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
        <div className={styles.viewerContainer}>
            <div className={styles.toolbar}>
                <div className={styles.pageControls}>
                    <button 
                        onClick={() => setPageNumber(prev => Math.max(prev - 1, 1))} 
                        disabled={pageNumber <= 1}
                        className={styles.toolBtn}
                    >
                        &larr; Prev
                    </button>
                    <span className={styles.pageInfo}>
                        Page {pageNumber} of {numPages || '--'}
                    </span>
                    <button 
                        onClick={() => setPageNumber(prev => Math.min(prev + 1, numPages || 1))} 
                        disabled={pageNumber >= (numPages || 1)}
                        className={styles.toolBtn}
                    >
                        Next &rarr;
                    </button>
                </div>
                
                <div className={styles.zoomControls}>
                    <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} className={styles.toolBtn}>-</button>
                    <span style={{ fontSize: '14px', fontWeight: 500, minWidth: '40px', textAlign: 'center' }}>
                        {Math.round(scale * 100)}%
                    </span>
                    <button onClick={() => setScale(s => Math.min(3.0, s + 0.25))} className={styles.toolBtn}>+</button>
                </div>
            </div>
            
            <div className={styles.documentWrapper}>
                <Document 
                    file={fileUrl} 
                    onLoadSuccess={onDocumentLoadSuccess}
                    loading={<div className={styles.loading}>Loading PDF...</div>}
                    error={<div className={styles.error}>Failed to load PDF file.</div>}
                >
                    <Page 
                        pageNumber={pageNumber} 
                        scale={scale} 
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                        className={styles.pdfPage}
                    />
                </Document>
            </div>
        </div>
    );
}
