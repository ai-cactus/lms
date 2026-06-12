import { describe, it, expect, vi, beforeEach } from 'vitest';
const getSignedUrl = vi.fn();
vi.mock('@/lib/storage', () => ({ getSignedUrl: (...a: unknown[]) => getSignedUrl(...a) }));
import { resolveVideoSource } from './index';

beforeEach(() => getSignedUrl.mockReset());

describe('resolveVideoSource', () => {
  it('self-host signs the storage URI', async () => {
    getSignedUrl.mockResolvedValue('https://signed/url');
    const src = resolveVideoSource('self');
    const url = await src.resolvePlaybackUrl(
      { videoProvider: 'self', videoStorageUri: 'gcs://b/k.mp4' },
      600,
    );
    expect(url).toBe('https://signed/url');
    expect(getSignedUrl).toHaveBeenCalledWith('gcs://b/k.mp4', 600);
  });
  it('throws when self-host lesson has no storage URI', async () => {
    const src = resolveVideoSource('self');
    await expect(
      src.resolvePlaybackUrl({ videoProvider: 'self', videoStorageUri: null }),
    ).rejects.toThrow();
  });
  it('throws for not-yet-implemented providers', () => {
    expect(() => resolveVideoSource('mux')).toThrow();
  });
});
