/**
 * Course Artifact Storage Utility
 *
 * Provides functions to store and retrieve large course JSON data
 * (article, slides, quiz, judge) in object storage (GCS/MinIO)
 * instead of PostgreSQL JSON columns.
 *
 * During the transition period, both the legacy JSON columns and the
 * new CourseArtifact table are supported. Callers should try artifacts
 * first, then fall back to raw JSON columns.
 */

import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/storage';
import { logger } from '@/lib/logger';

/** Artifact types that correspond to Course JSON columns */
export type ArtifactType =
  | 'course_json'
  | 'article_meta'
  | 'article_markdown'
  | 'slides'
  | 'quiz'
  | 'judge';

/** Mapping from artifact type to the Course column name */
const ARTIFACT_COLUMN_MAP: Record<ArtifactType, string> = {
  course_json: 'rawCourseJson',
  article_meta: 'rawArticleMeta',
  article_markdown: 'rawArticleMarkdown',
  slides: 'rawSlidesJson',
  quiz: 'rawQuizJson',
  judge: 'rawJudgeJson',
};

/**
 * Store a course artifact in object storage and record it in the DB.
 *
 * If storage upload fails, the data remains in the legacy JSON column
 * so the system degrades gracefully.
 */
export async function storeArtifact(
  courseId: string,
  type: ArtifactType,
  data: unknown,
): Promise<void> {
  const buffer = Buffer.from(JSON.stringify(data), 'utf-8');
  const storagePath = `courses/${courseId}/${type}-v1.json`;

  try {
    const { storageUri } = await uploadFile(storagePath, buffer, 'application/json');

    // Determine the next version number
    const latest = await prisma.courseArtifact.findFirst({
      where: { courseId, type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await prisma.courseArtifact.create({
      data: {
        courseId,
        type,
        storageUri,
        sizeBytes: buffer.length,
        version: nextVersion,
      },
    });

    logger.info({
      msg: 'Artifact stored',
      courseId,
      type,
      version: nextVersion,
      sizeBytes: buffer.length,
      storageUri,
    });
  } catch (error) {
    logger.error({
      msg: 'Failed to store artifact; data remains in legacy column',
      courseId,
      type,
      error: error instanceof Error ? error.message : String(error),
    });
    // Intentionally do NOT throw — the legacy column still holds the data
  }
}

/**
 * Retrieve a course artifact from object storage.
 *
 * Falls back to the legacy JSON column if no artifact record exists
 * or if the storage read fails.
 */
export async function getArtifact<T = unknown>(
  courseId: string,
  type: ArtifactType,
): Promise<T | null> {
  // Try artifact storage first
  try {
    const artifact = await prisma.courseArtifact.findFirst({
      where: { courseId, type },
      orderBy: { version: 'desc' },
    });

    if (artifact) {
      const { getSignedUrl } = await import('@/lib/storage');
      const signedUrl = await getSignedUrl(artifact.storageUri, 300);

      const response = await fetch(signedUrl);
      if (response.ok) {
        const json = await response.json();
        return json as T;
      }

      logger.warn({
        msg: 'Failed to fetch artifact from storage; falling back to column',
        courseId,
        type,
        status: response.status,
      });
    }
  } catch (error) {
    logger.warn({
      msg: 'Artifact storage read failed; falling back to column',
      courseId,
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Fallback: read from legacy JSON column
  const columnName = ARTIFACT_COLUMN_MAP[type];
  if (!columnName) return null;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { [columnName]: true },
  });

  if (!course) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawValue = (course as any)[columnName];

  // For article_markdown, the column is a String not Json
  if (type === 'article_markdown') {
    return rawValue as string | null as T | null;
  }

  return rawValue as T | null;
}

/**
 * Get the latest artifact metadata (without downloading the content).
 */
export async function getArtifactMeta(courseId: string, type: ArtifactType) {
  return prisma.courseArtifact.findFirst({
    where: { courseId, type },
    orderBy: { version: 'desc' },
  });
}
