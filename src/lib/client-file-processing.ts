import mammoth from 'mammoth';

// We use a CDN for the worker to avoid build/bundling issues with Next.js
const PDFJS_WORKER_SRC = `https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs`;

export async function extractTextFromPdf(file: File): Promise<string> {
    try {
        // Dynamic import to avoid SSR issues
        const pdfjs = await import('pdfjs-dist');

        // Set worker source
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
        }

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdfDocument = await loadingTask.promise;

        let fullText = '';
        for (let i = 1; i <= pdfDocument.numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
        }

        return fullText;
    } catch (error) {
        console.error("Error extracting PDF text client-side:", error);
        throw new Error("Failed to extract text from PDF");
    }
}

export async function extractTextFromDocx(file: File): Promise<string> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    } catch (error) {
        console.error("Error extracting DOCX text client-side:", error);
        throw new Error("Failed to extract text from DOCX");
    }
}

export async function processFileClientSide(file: File): Promise<{ name: string; type: string; content: string }> {
    let content = "";

    if (file.type === 'application/pdf') {
        content = await extractTextFromPdf(file);
    } else if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        content = await extractTextFromDocx(file);
    } else {
        // Default to text
        content = await file.text();
    }

    return {
        name: file.name,
        type: file.type,
        content
    };
}
