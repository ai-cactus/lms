const { jsPDF } = require('jspdf');
const crypto = require('crypto');

async function testStrategies() {
    console.log("Generating sample PDF...");
    const doc = new jsPDF();
    doc.text("Hello World from PDF", 10, 10);
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    console.log("PDF generated. Size:", pdfBuffer.length);

    console.log("\n--- Testing Strategy 1: pdf-parse ---");
    try {
        const pdfParseModule = require('pdf-parse');
        let pdfParse = pdfParseModule;
        if (typeof pdfParse !== 'function' && pdfParseModule.default) {
            console.log("Using default export for pdf-parse");
            pdfParse = pdfParseModule.default;
        }

        if (typeof pdfParse === 'function') {
            const data = await pdfParse(pdfBuffer);
            console.log("pdf-parse success!");
            console.log("Text:", data.text.trim());
        } else {
            console.log("pdf-parse is NOT a function. Type:", typeof pdfParse);
        }
    } catch (e) {
        console.error("pdf-parse failed:", e.message);
    }

    console.log("\n--- Testing Strategy 2: pdfjs-dist ---");
    try {
        // Use dynamic import for ESM module
        const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const pdfjs = pdfjsModule.default || pdfjsModule;

        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
        const pdfDocument = await loadingTask.promise;

        console.log(`pdfjs-dist loaded. Pages: ${pdfDocument.numPages}`);
        let fullText = '';
        for (let i = 1; i <= pdfDocument.numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        console.log("pdfjs-dist success!");
        console.log("Text:", fullText.trim());
    } catch (e) {
        console.error("pdfjs-dist failed:", e);
    }
}

testStrategies();
