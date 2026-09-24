import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { invalidateCourseThumbnailMeta } from '@/lib/video/playback-cache';
import { isCustomThumbnailStorageUri } from '@/lib/video/thumbnail';
import { expireVideoCatalog } from '@/lib/video/catalog-cache';

/**
 * Server-side writes of `Course.thumbnailStorageUri`, shared by the upload
 * route and the regenerate/remove Server Actions so all three evict, revalidate
 * and clean up identically. Callers own authorization (system admin).
 */

/** Only a global video course carries a system-managed thumbnail. */
export async function findManagedVideoCourse(
  courseId: string,
): Promise<{ id: string; thumbnailStorageUri: string | null } | null> {
  return prisma.course.findFirst({
    where: { id: courseId, type: 'video', isGlobal: true },
    select: { id: true, thumbnailStorageUri: true },
  });
}

/**
 * Deletes a replaced custom thumbnail. Best-effort: the row already points
 * elsewhere, so a failure leaves only an unreferenced object for the video
 * sweeper. Anything outside the custom-thumbnail prefix — a preview or lesson
 * poster — belongs to its video and is never deleted here.
 */
export async function deleteReplacedCustomThumbnail(
  previousStorageUri: string | null,
  courseId: string,
): Promise<void> {
  if (!isCustomThumbnailStorageUri(previousStorageUri)) return;
  try {
    await deleteFile(previousStorageUri);
  } catch (err) {
    logger.error({
      msg: '[video-thumbnail] Failed to delete replaced custom thumbnail',
      err,
      courseId,
    });
  }
}

/** Points the course at `nextStorageUri`; null restores the automatic chain. */
export async function writeCourseThumbnail(
  courseId: string,
  nextStorageUri: string | null,
): Promise<void> {
  await prisma.course.update({
    where: { id: courseId },
    data: { thumbnailStorageUri: nextStorageUri },
  });
}

/**
 * Evicts the thumbnail route's cached meta and revalidates every surface that
 * lists the course. Call after any link of the thumbnail chain changed.
 */
export function refreshCourseThumbnailSurfaces(courseId: string): void {
  invalidateCourseThumbnailMeta(courseId);
  revalidatePath('/system/video-courses');
  revalidatePath(`/system/video-courses/${courseId}/edit`);
  // The org-facing course lists read the cached global catalog.
  expireVideoCatalog();
}
