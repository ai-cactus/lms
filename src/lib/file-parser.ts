// @ts-ignore
import * as pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export async function extractTextFromFile(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (file.type === 'application/pdf') {
        const parser = (pdfParse as any).default || pdfParse;
        const data = await parser(buffer);
        return data.text;
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
