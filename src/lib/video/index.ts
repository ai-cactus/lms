import type { VideoProviderKey, VideoSource } from './types';
import { SelfHostVideoSource } from './self-host';

export * from './types';
export { parseQuizFile, parseQuizCsv, parseQuizJson } from './quiz-import';

export function resolveVideoSource(provider: VideoProviderKey | string): VideoSource {
  switch (provider) {
    case 'self':
      return SelfHostVideoSource;
    default:
      throw new Error(`Video provider "${provider}" is not implemented yet`);
  }
}
