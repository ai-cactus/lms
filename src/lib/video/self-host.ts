import { getSignedUrl } from '@/lib/storage';
import type { VideoSource } from './types';

export const SelfHostVideoSource: VideoSource = {
  async resolvePlaybackUrl(lesson, expirySeconds = 900) {
    if (!lesson.videoStorageUri) throw new Error('Self-host lesson has no videoStorageUri');
    return getSignedUrl(lesson.videoStorageUri, expirySeconds);
  },
};
