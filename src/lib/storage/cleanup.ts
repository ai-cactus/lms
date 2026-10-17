import { deleteFile } from '@/lib/storage';
import { logger } from '@/lib/logger';

export interface StorageDeleteContext {
  /** Prefixes every log line, e.g. `[system]`. */
  module: string;
  /** Ids identifying what the objects belonged to, for the log line. Never an email or a key. */
  ids: Record<string, string>;
}

export interface StorageDeleteOutcome {
  attempted: number;
  /** The exact URIs whose delete failed, for the caller to record for retry. */
  failed: string[];
}

/**
 * Deletes each of the given stored objects by its exact recorded URI.
 *
 * Deliberately has no prefix or listing form: this repo has twice lost
 * production videos to prefix sweeps, so a caller can only delete what a row
 * actually named. Duplicates are collapsed, each delete is isolated, and it
 * never throws — call it after the owning rows have committed, so a storage
 * failure costs an orphaned object rather than a half-deleted record.
 */
export async function deleteStorageObjects(
  uris: readonly string[],
  context: StorageDeleteContext,
): Promise<StorageDeleteOutcome> {
  const unique = [...new Set(uris.filter((uri) => uri.length > 0))];
  const failed: string[] = [];

  for (const uri of unique) {
    try {
      await deleteFile(uri);
    } catch (err) {
      failed.push(uri);
      logger.warn({
        msg: `${context.module} Failed to delete a stored object`,
        ...context.ids,
        err,
      });
    }
  }

  logger.info({
    msg: `${context.module} Deleted stored objects by exact URI`,
    ...context.ids,
    attempted: unique.length,
    failed: failed.length,
  });

  return { attempted: unique.length, failed };
}
