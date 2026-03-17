import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

async function main() {
  try {
    console.log('Deleting all documents from database...');
    // Delete documents (cascade should handle versions/reports)
    await prisma.document.deleteMany({});
    console.log('Database cleared.');

    console.log('Deleting physical files...');
    try {
      const files = await fs.readdir(UPLOAD_DIR);
      for (const file of files) {
        if (file !== '.gitkeep') {
          // Keep gitkeep if exists
          await fs.unlink(path.join(UPLOAD_DIR, file));
        }
      }
      console.log('Physical files deleted.');
    } catch (e) {
      console.log('Upload directory might be empty or not exist:', e);
    }
  } catch (e) {
    console.error('Error resetting documents:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
