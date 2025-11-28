import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import mammoth from 'mammoth';


const CACHE_DIR = path.join(process.cwd(), '.cache', 'processed-files');

// Ensure cache directory exists
async function ensureCacheDir() {
    try {
        await fs.access(CACHE_DIR);
    } catch {
        await fs.mkdir(CACHE_DIR, { recursive: true });
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
    await ensureCacheDir();
    const filePath = path.join(CACHE_DIR, `${key}.txt`);
    await fs.writeFile(filePath, text, 'utf-8');
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
            console.log("Extracting text from PDF using pdfjs-dist...");
            // Dynamic import to avoid top-level issues and reduce initial bundle load
            const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

            const uint8Array = new Uint8Array(buffer);
            const loadingTask = pdfjsLib.getDocument({
                data: uint8Array,
                // Disable worker for Node.js environment to avoid worker loading issues
                disableFontFace: true,
            });
            const doc = await loadingTask.promise;

            let fullText = "";
            for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(" ");
                fullText += pageText + "\n";
            }
            text = fullText;
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
