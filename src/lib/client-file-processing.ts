import mammoth from 'mammoth';

export async function extractTextFromPdf(file: File): Promise<string> {
    try {
        // Use server-side API to extract PDF text (avoids Next.js bundling issues with pdfjs-dist)
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/document/extract-pdf', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error('Failed to extract PDF text');
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error extracting PDF text:", error);
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
