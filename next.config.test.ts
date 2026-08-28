import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

/**
 * The CSP is a hand-maintained array of directive strings, so a missing entry
 * fails silently at runtime rather than at build time: the browser falls back to
 * `default-src 'self'` and blocks the resource. `media-src` was omitted, which
 * blocked every `blob:` preview player — in production as well as staging.
 */
async function cspDirectives(): Promise<Map<string, Set<string>>> {
  const routes = await nextConfig.headers!();
  const csp = routes
    .flatMap((route) => route.headers)
    .find((header) => header.key === 'Content-Security-Policy');

  if (!csp) throw new Error('No Content-Security-Policy header is configured');

  return new Map(
    csp.value.split(';').map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, new Set(sources)];
    }),
  );
}

describe('Content-Security-Policy', () => {
  it('allows blob: media so locally-selected videos can be previewed', async () => {
    const media = (await cspDirectives()).get('media-src');

    expect(media, 'media-src must be declared explicitly — default-src blocks blob:').toBeDefined();
    expect(media).toContain('blob:');
    expect(media).toContain("'self'");
  });

  it('keeps blob: on every directive that serves browser-generated URLs', async () => {
    const directives = await cspDirectives();

    for (const name of ['img-src', 'media-src', 'worker-src']) {
      expect(directives.get(name), `${name} lost its blob: source`).toContain('blob:');
    }
  });
});
