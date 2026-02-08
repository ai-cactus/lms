import fs from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export async function saveFile(file: File): Promise<string> {
    const buffer = Buffer.from(await file.arrayBuffer());

    // Create unique filename to prevent overwrites
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const filename = `${timestamp}-${safeName}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Ensure directory exists (redundant if mkdir -p run, but safe)
    try {
        await fs.access(UPLOAD_DIR);
    } catch {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
    }

    await fs.writeFile(filepath, buffer);

    // Return path relative to public for serving (or just storage reference)
    return `/uploads/${filename}`;
}
