/**
 * BullMQ queue for normalizing uploaded course videos.
 *
 * Follows the same pattern as manual-indexer-queue.ts. Jobs are enqueued by
 * createVideoCourse (after a video course is created) and consumed by the
 * video-transcode-worker, which re-encodes each source video to a web-safe,
 * universally-playable MP4 (H.264 High / 8-bit yuv420p + AAC, +faststart).
 *
 * Why: videos uploaded by the back office are often .mov-derived MP4s whose
 * moov atom sits at the end and/or carry QuickTime edit lists. Chrome's media
 * pipeline chokes on those (black frame / desynced audio / error) while Firefox
 * tolerates them. Re-encoding produces a clean, faststart stream that plays in
 * every browser and on mobile.
 */

import { Queue } from 'bullmq';
import { redis } from './redis';

export const VIDEO_TRANSCODE_QUEUE_NAME = 'video-transcode-queue';

export interface VideoTranscodeJobData {
  /** What the normalized video belongs to. */
  targetType: 'lesson' | 'course-preview';
  /** Lesson id (targetType=lesson) or Course id (targetType=course-preview). */
  targetId: string;
  /** minio:// or gcs:// URI of the source (raw upload) video to normalize. */
  storageUri: string;
}

export const videoTranscodeQueue = new Queue<VideoTranscodeJobData>(VIDEO_TRANSCODE_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 20 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/**
 * Best-effort enqueue: a transcode is an optimization, not a hard dependency of
 * course creation. If Redis is unreachable (e.g. local dev without Redis) we log
 * and move on — the raw upload still plays, just not normalized.
 */
export async function enqueueVideoTranscode(data: VideoTranscodeJobData): Promise<void> {
  await videoTranscodeQueue.add('transcode', data);
}
