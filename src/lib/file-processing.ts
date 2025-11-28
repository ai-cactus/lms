import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import mammoth from 'mammoth';
import os from 'os';

// Import pdf-parse and pdfjs-dist dynamically to avoid build issues if possible, 
// or use top level if next.config.ts handles it. 
// Given the issues, let's try a robust approach.
// We will use require inside the function to be safe, but handle the export type.

const CACHE_DIR = path.join(os.tmpdir(), 'lms-processed-files');

// Ensure cache directory exists
async function ensureCacheDir() {
    try {
        await fs.access(CACHE_DIR);
    } catch {
        try {
            await fs.mkdir(CACHE_DIR, { recursive: true });
        } catch (error) {
            console.warn('Failed to create cache directory:', error);
        }
    }
}

// Generate MD5 hash for cache key
function getCacheKey(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

// Get cached text if available
async function getCachedText(key: string): Promise<string | null> {
    await ensureCacheDir();
    const filePath = path.join(CACHE_DIR, `${key}.txt`);
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

// Save text to cache
async function setCachedText(key: string, text: string): Promise<void> {
    try {
        await ensureCacheDir();
        const filePath = path.join(CACHE_DIR, `${key}.txt`);
        await fs.writeFile(filePath, text, 'utf-8');
    } catch (error) {
    }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
    console.log("Attempting to extract PDF text...");

    // Strategy 1: pdf-parse
    try {
        console.log("Strategy 1: pdf-parse");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParseModule = require('pdf-parse');

        // Handle different export types (function vs object with default)
        let pdfParse = pdfParseModule;
        if (typeof pdfParse !== 'function' && pdfParseModule.default) {
            pdfParse = pdfParseModule.default;
        }

        if (typeof pdfParse === 'function') {
            const data = await pdfParse(buffer);
            console.log(`pdf-parse success. Text length: ${data.text?.length}`);
            return data.text;
        } else {
            console.warn("pdf-parse is not a function:", typeof pdfParse, Object.keys(pdfParseModule));
            // Fallthrough to Strategy 2
        }
    } catch (e) {
        console.error("Strategy 1 (pdf-parse) failed:", e);
    }

    // Strategy 2: pdfjs-dist (Fallback)
    try {
        console.log("Strategy 2: pdfjs-dist");
        // Use dynamic import for ESM module
        // @ts-ignore
        const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const pdfjs = pdfjsModule.default || pdfjsModule;

        // Load the document
        // Note: pdfjs-dist expects Uint8Array, Buffer is compatible
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
        const pdfDocument = await loadingTask.promise;

        console.log(`pdfjs-dist loaded. Pages: ${pdfDocument.numPages}`);

        let fullText = '';
        for (let i = 1; i <= pdfDocument.numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
        }

        console.log(`pdfjs-dist success. Text length: ${fullText.length}`);
        return fullText;

    } catch (e) {
        console.error("Strategy 2 (pdfjs-dist) failed:", e);
        throw new Error("All PDF extraction strategies failed.");
    }
}

export async function extractTextFromFile(file: { name: string; type: string; data: string }): Promise<string> {
    // 1. Convert Base64 to Buffer
    const base64Data = file.data.split(';base64,').pop();
    if (!base64Data) throw new Error(`Invalid file data for ${file.name}`);

    const buffer = Buffer.from(base64Data, 'base64');
    const cacheKey = getCacheKey(buffer);

    // 2. Check Cache
    const cached = await getCachedText(cacheKey);
    if (cached) {
        console.log(`Cache hit for ${file.name}`);
        return cached;
    }

    console.log(`Processing file: ${file.name} (${file.type})`);
    let text = "";

    // 3. Process based on type
    try {
        if (file.type === 'application/pdf') {
            text = await extractPdfText(buffer);
        } else if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            console.log("Extracting text from DOCX using mammoth...");
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
            if (result.messages.length > 0) {
                console.log("Mammoth messages:", result.messages);
            }
        } else if (file.type.startsWith('image/')) {
            console.warn(`Image file detected. Skipping text extraction.`);
            return `[Image File: ${file.name} - Content extraction not supported]`;
        } else {
            // Default to plain text
            text = buffer.toString('utf-8');
        }
    } catch (error) {
        console.error(`Error extracting text from ${file.name}:`, error);
        throw new Error(`Failed to extract text from ${file.name}`);
    }

    // 4. Save to Cache
    if (text) {
        await setCachedText(cacheKey, text);
    }

    return text;
}
