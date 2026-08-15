import { getSignedUrl } from '@/lib/storage';
import { getSignedUrlTtlSeconds } from './playback-cache';
import type { VideoSource } from './types';

export const SelfHostVideoSource: VideoSource = {
  async resolvePlaybackUrl(lesson, expirySeconds = getSignedUrlTtlSeconds()) {
    if (!lesson.videoStorageUri) throw new Error('Self-host lesson has no videoStorageUri');
    return getSignedUrl(lesson.videoStorageUri, expirySeconds);
  },
};
