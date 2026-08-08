/**
 * Guards the two header defaults the video proxies used to get wrong, both of
 * which broke iOS specifically:
 *  - `content-type: video/mp4` asserted over a WebM object;
 *  - `accept-ranges: bytes` advertised on a 200 that could not serve a range.
 */
import { describe, it, expect } from 'vitest';
import { applyProxiedMediaHeaders, videoContentTypeFromStorageUri } from './proxy-headers';

describe('videoContentTypeFromStorageUri', () => {
  it.each([
    ['minio://lms-documents/system/videos/normalized/1-a.mp4', 'video/mp4'],
    ['gs://bucket/system/videos/raw/clip.webm', 'video/webm'],
    ['minio://bucket/system/videos/raw/CLIP.WEBM', 'video/webm'],
    ['minio://bucket/system/videos/raw/a.b.c.mp4', 'video/mp4'],
  ])('%s → %s', (uri, expected) => {
    expect(videoContentTypeFromStorageUri(uri)).toBe(expected);
  });

  it.each([
    ['no extension', 'minio://bucket/system/videos/raw/clip'],
    ['unknown extension', 'minio://bucket/system/videos/raw/clip.mkv'],
    ['a dot in a directory only', 'minio://bucket/system.videos/raw/clip'],
    ['a dotfile with no extension', 'minio://bucket/system/videos/.clip'],
    ['empty', ''],
  ])('says nothing rather than guessing — %s', (_label, uri) => {
    expect(videoContentTypeFromStorageUri(uri)).toBeNull();
  });

  it('ignores a query string or fragment on a signed URL', () => {
    expect(videoContentTypeFromStorageUri('https://s/clip.webm?X-Amz-Signature=abc')).toBe(
      'video/webm',
    );
    expect(videoContentTypeFromStorageUri('https://s/clip.mp4#t=0.1')).toBe('video/mp4');
  });
});

describe('applyProxiedMediaHeaders', () => {
  it('adds accept-ranges to a 206 only', () => {
    const partial = new Headers();
    applyProxiedMediaHeaders(partial, 206, 'minio://b/v.mp4');
    expect(partial.get('accept-ranges')).toBe('bytes');

    const full = new Headers();
    applyProxiedMediaHeaders(full, 200, 'minio://b/v.mp4');
    expect(full.get('accept-ranges')).toBeNull();
  });

  it('leaves everything upstream already said untouched', () => {
    const headers = new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'none' });
    applyProxiedMediaHeaders(headers, 206, 'minio://b/v.webm');

    expect(headers.get('content-type')).toBe('video/mp4');
    expect(headers.get('accept-ranges')).toBe('none');
  });

  it('omits content-type entirely when the key implies nothing', () => {
    const headers = new Headers();
    applyProxiedMediaHeaders(headers, 206, 'minio://b/v');

    expect(headers.get('content-type')).toBeNull();
  });
});
