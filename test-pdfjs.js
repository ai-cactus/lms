
// Minimal Polyfill for DOMMatrix if needed (pdfjs-dist sometimes needs it)
if (typeof DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {
        constructor() {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        }
        toString() { return "matrix(1, 0, 0, 1, 0, 0)"; }
        multiply(m) { return this; }
        translate(x, y) { return this; }
        scale(x, y) { return this; }
    };
}

async function testPdfJs() {
    try {
        console.log("Importing pdfjs-dist...");
        // Use dynamic import for ESM module
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        console.log("Imported pdfjsLib.");

        // We need to set up the worker. In Node, we can mock or shim it,
        // OR we can disable worker by setting workerSrc to null/fake? 
        // pdfjs-dist in Node often needs a worker or fake worker.
        // Let's try without setting workerSrc first, usually it falls back to main thread or throws.
        // If it fails, we point to pdf.worker.mjs

        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

        // Mock a PDF buffer (Standard "Hello World" PDF)
        const dummyPdfBuffer = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 12 >>\nstream\nHello World\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000200 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n261\n%%EOF");

        console.log("Loading document...");
        const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(dummyPdfBuffer),
            // Disable worker for simplicity in Node if possible? 
            // Or ensure we don't need canvas
            disableFontFace: true,
        });

        const pdfDocument = await loadingTask.promise;
        console.log("PDF loaded, numPages:", pdfDocument.numPages);

        const page = await pdfDocument.getPage(1);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        console.log("Extracted text:", text);

    } catch (error) {
        console.error("Error in testPdfJs:", error);
    }
}

testPdfJs();
