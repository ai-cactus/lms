import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

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
    // Note: For PDFs and images, we'll attempt to read as text
    // This works for text-based PDFs but not scanned/image PDFs
    if (file.type === 'application/pdf') {
        console.warn(`PDF file detected. Attempting to read as text (works only for text-based PDFs, not scanned images).`);
        text = buffer.toString('utf-8');
    } else if (file.type.startsWith('image/')) {
        console.warn(`Image file detected. Cannot perform OCR. Attempting to read as text (likely to fail).`);
        text = buffer.toString('utf-8');
    } else if (file.type === 'text/plain' || file.type === 'application/json' || file.type === 'text/markdown' || file.type === '') {
        text = buffer.toString('utf-8');
    } else {
        // Try as text for unknown types
        console.warn(`Unknown file type ${file.type}, attempting to read as text.`);
        text = buffer.toString('utf-8');
    }

    // 4. Save to Cache
    if (text) {
        await setCachedText(cacheKey, text);
    }

    return text;
}
