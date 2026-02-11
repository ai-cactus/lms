import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import path from 'path';

export async function extractTextFromFile(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (file.type === 'application/pdf') {
        try {
            // pdf-parse relies on pdfjs-dist which needs a worker
            // In Node environments, we need to point to the legacy worker file
            const workerPath = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
            console.log(`Setting PDF Worker to: ${workerPath}`);
            PDFParse.setWorker(workerPath);

            // pdf-parse v2+ is a class
            const parser = new PDFParse({ data: buffer });
            const data = await parser.getText();
            const text = data.text.trim();

            console.log(`Extracted PDF text length: ${text.length} `);

            if (text.length === 0) {
                console.warn("PDF parsing returned empty string.");
            }

            return text;
        } catch (e: any) {
            console.error("PDF Parsing Error:", e);
            throw new Error(`PDF Parsing Failed: ${e.message || 'Unknown error'}`);
        }
    } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.name.endsWith('.docx')
    ) {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    } else {
        throw new Error('Unsupported file type. Please upload a PDF or DOCX file.');
    }
}
