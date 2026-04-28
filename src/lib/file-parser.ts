/**
 * File text extraction utilities.
 * Uses pdf-parse@1.1.1 (pure Node.js, no DOM polyfills required) for PDF files
 * and mammoth for DOCX files.
 */
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

export async function extractTextFromFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (file.type === 'application/pdf') {
    try {
      const data = await pdfParse(buffer);
      const text = data.text.trim();

      if (text.length === 0) {
        console.warn('PDF parsing returned empty string.');
      }

      return text;
    } catch (e: unknown) {
      const error = e as Error;
      console.error('PDF Parsing Error:', error);
      throw new Error(`PDF Parsing Failed: ${error.message || 'Unknown error'}`);
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
