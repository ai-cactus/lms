'use client';

import dynamic from 'next/dynamic';

// react-pdf / pdfjs rely on browser-only APIs and pull in a large worker bundle,
// so load the viewer as a client-only, lazily-loaded chunk kept out of the
// initial document-page bundle.
const PdfViewer = dynamic(() => import('./PdfViewer'), {
  ssr: false,
  loading: () => (
    <div className="p-12 text-center text-base text-text-secondary">Loading PDF viewer…</div>
  ),
});

export default PdfViewer;
