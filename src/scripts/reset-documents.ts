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
import { logger } from '../lib/logger';

const prisma = new PrismaClient();

async function main() {
  logger.info({ msg: 'Fetching all document versions...' });

  const versions = await prisma.documentVersion.findMany({
    select: { id: true, storagePath: true },
  });

  logger.info({ msg: `Found ${versions.length} document version(s) to clean up.` });

  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const version of versions) {
    if (isLegacyPath(version.storagePath)) {
      logger.warn({
        msg: `  [SKIP] Legacy local path — skipping storage delete: ${version.storagePath}`,
      });
      skipped++;
      continue;
    }

    try {
      await deleteFile(version.storagePath);
      logger.info({ msg: `  [OK]   Deleted: ${version.storagePath}` });
      deleted++;
    } catch (err: unknown) {
      const e = err as Error;
      logger.error({
        msg: `  [FAIL] Could not delete ${version.storagePath}: ${e.message}`,
        err: e,
      });
      failed++;
    }
  }

  logger.info({
    msg: `\nStorage cleanup: ${deleted} deleted, ${skipped} skipped, ${failed} failed.`,
  });

  logger.info({ msg: '\nDeleting all documents from database...' });
  const result = await prisma.document.deleteMany({});
  logger.info({ msg: `Database cleared — removed ${result.count} document(s).` });
}

main()
  .catch((e) => {
    logger.error({ msg: 'Fatal error:', err: e });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
