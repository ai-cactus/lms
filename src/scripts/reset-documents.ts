/**
 * Reset Documents Script
 *
 * Deletes all documents from the database and removes their stored objects
 * from cloud storage (GCS or MinIO, depending on env config).
 *
 * Legacy local paths (/uploads/...) are skipped — delete them manually if needed.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json src/scripts/reset-documents.ts
 *
 * WARNING: This is destructive and irreversible. Use only in dev/staging.
 */

import { PrismaClient } from '@prisma/client';
import { deleteFile, isLegacyPath } from '../lib/storage';

const prisma = new PrismaClient();

async function main() {
  console.log('Fetching all document versions...');

  const versions = await prisma.documentVersion.findMany({
    select: { id: true, storagePath: true },
  });

  console.log(`Found ${versions.length} document version(s) to clean up.`);

  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const version of versions) {
    if (isLegacyPath(version.storagePath)) {
      console.warn(`  [SKIP] Legacy local path — skipping storage delete: ${version.storagePath}`);
      skipped++;
      continue;
    }

    try {
      await deleteFile(version.storagePath);
      console.log(`  [OK]   Deleted: ${version.storagePath}`);
      deleted++;
    } catch (err: unknown) {
      const e = err as Error;
      console.error(`  [FAIL] Could not delete ${version.storagePath}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nStorage cleanup: ${deleted} deleted, ${skipped} skipped, ${failed} failed.`);

  console.log('\nDeleting all documents from database...');
  const result = await prisma.document.deleteMany({});
  console.log(`Database cleared — removed ${result.count} document(s).`);
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
