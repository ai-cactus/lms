"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronUp, ChevronDown, X, Menu } from "lucide-react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Set up PDF.js worker
// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

interface DocumentPreviewProps {
    fileUrl: string;
    fileName: string;
    onClose: () => void;
    onAnalyze: () => void;
}

export default function DocumentPreview({ fileUrl, fileName, onClose, onAnalyze }: DocumentPreviewProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const [pageNumber, setPageNumber] = useState<number>(1);
    const [showToc, setShowToc] = useState(false);

    function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
        setNumPages(numPages);
    }

    const goToPrevPage = () => {
        setPageNumber((prev) => Math.max(1, prev - 1));
    };

    const goToNextPage = () => {
        setPageNumber((prev) => Math.min(numPages, prev + 1));
    };

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="text-slate-600 hover:text-slate-900 transition-colors"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">{fileName}</h2>
                        <p className="text-sm text-slate-500">Updated 5 mins ago</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Page Navigation */}
                    <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-1.5">
                        <button
                            onClick={goToPrevPage}
                            disabled={pageNumber <= 1}
                            className="text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronUp className="w-4 h-4" />
                        </button>
                        <span className="text-sm text-slate-700 min-w-[60px] text-center">
                            {pageNumber} of {numPages}
                        </span>
                        <button
                            onClick={goToNextPage}
                            disabled={pageNumber >= numPages}
                            className="text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronDown className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Analyze Button */}
                    <button
                        onClick={onAnalyze}
                        className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                        </svg>
                        Analyze
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex">
                {/* Table of Contents (optional) */}
                {showToc && (
                    <div className="w-64 bg-slate-50 border-r border-gray-200 p-4 overflow-y-auto">
                        <button
                            onClick={() => setShowToc(false)}
                            className="mb-4 flex items-center gap-2 text-slate-600 hover:text-slate-900"
                        >
                            <X className="w-4 h-4" />
                            <span className="text-sm">Close</span>
                        </button>
                        <h3 className="font-semibold text-slate-900 mb-3">Table of Contents</h3>
                        {/* TOC items would go here */}
                    </div>
                )}

                {/* PDF Viewer */}
                <div className="flex-1 overflow-y-auto bg-slate-100 flex justify-center p-8">
                    <div className="bg-white shadow-lg">
                        <Document
                            file={fileUrl}
                            onLoadSuccess={onDocumentLoadSuccess}
                            loading={
                                <div className="flex items-center justify-center h-screen">
                                    <div className="text-slate-600">Loading document...</div>
                                </div>
                            }
                            error={
                                <div className="flex items-center justify-center h-screen">
                                    <div className="text-red-600">Failed to load document.</div>
                                </div>
                            }
                        >
                            <Page
                                pageNumber={pageNumber}
                                renderTextLayer={true}
                                renderAnnotationLayer={true}
                                width={800}
                            />
                        </Document>
                    </div>
                </div>

                {/* TOC Toggle Button */}
                {!showToc && (
                    <button
                        onClick={() => setShowToc(true)}
                        className="absolute left-4 top-24 bg-white border border-gray-300 rounded-lg p-2 shadow-sm hover:bg-slate-50 transition-colors"
                        title="Table of Contents"
                    >
                        <Menu className="w-5 h-5 text-slate-600" />
                    </button>
                )}
            </div>
        </div>
    );
}
