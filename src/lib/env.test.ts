/**
 * BUG-19 risk coverage: validateEnv() is the only caller of
 * resolveVertexGenerationTarget()/resolveVertexEmbeddingLocation() at boot
 * time. vertex-config.test.ts covers those functions directly, but nothing
 * previously exercised the wiring in validateEnv() itself — that it (a)
 * actually fails boot on a malformed VERTEX_LOCATION/VERTEX_MODEL/
 * GOOGLE_LOCATION, (b) still boots cleanly with none of them set (defaults),
 * and (c) is a no-op in the test/CI/build carve-out regardless of Vertex
 * config, matching the other required-env checks it runs alongside.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { logger } from '@/lib/logger';
import { validateEnv } from './env';

describe('validateEnv — Vertex config wiring', () => {
  const originalEnv = process.env;

  const REQUIRED_ENV = {
    DATABASE_URL: 'postgres://localhost/test',
    NEXTAUTH_SECRET: 'secret',
    AUTH_SECRET: 'secret',
    REDIS_URL: 'redis://localhost',
    GOOGLE_PROJECT_ID: 'test-project',
    SMTP_USER: 'user@example.com',
    SMTP_PASSWORD: 'password',
  };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    // Force past the isBuildOrTest carve-out so validateEnv() actually runs
    // its checks instead of no-opping, as it does under the real vitest env.
    // NODE_ENV is typed read-only, so it needs vi.stubEnv rather than assignment.
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.CI;
    delete process.env.NEXT_PHASE;
    delete process.env.VERTEX_LOCATION;
    delete process.env.VERTEX_MODEL;
    delete process.env.GOOGLE_LOCATION;
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.info).mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllEnvs();
  });

  it('boots cleanly with no VERTEX_* / GOOGLE_LOCATION set (defaults apply)', () => {
    expect(() => validateEnv()).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('boots cleanly with well-formed VERTEX_LOCATION/VERTEX_MODEL/GOOGLE_LOCATION', () => {
    process.env.VERTEX_LOCATION = 'europe-west4';
    process.env.VERTEX_MODEL = 'gemini-3.5-flash-lite';
    process.env.GOOGLE_LOCATION = 'europe-west4';

    expect(() => validateEnv()).not.toThrow();
  });

  it('fails boot on a malformed VERTEX_LOCATION', () => {
    process.env.VERTEX_LOCATION = 'us-central1.evil.example';

    expect(() => validateEnv()).toThrow(/vertex: Unsupported Vertex AI location/);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: '[env] Environment validation failed',
        issues: expect.arrayContaining([expect.stringContaining('vertex:')]),
      }),
    );
  });

  it('fails boot on a malformed VERTEX_MODEL', () => {
    process.env.VERTEX_MODEL = 'models/gemini-3.1-flash-lite';

    expect(() => validateEnv()).toThrow(/vertex: Invalid Vertex AI model id/);
  });

  it('fails boot on a GOOGLE_LOCATION that is not a single region (multi-region "us")', () => {
    process.env.GOOGLE_LOCATION = 'us';

    expect(() => validateEnv()).toThrow(/vertex: GOOGLE_LOCATION must be a single region/);
  });

  it('fails boot on a malformed GOOGLE_LOCATION', () => {
    process.env.GOOGLE_LOCATION = 'not-a-real-region!!';

    expect(() => validateEnv()).toThrow(/vertex:/);
  });

  it('reports the Vertex issue alongside other unrelated env issues in one throw', () => {
    delete process.env.DATABASE_URL;
    process.env.VERTEX_LOCATION = 'us-east';

    let caught: Error | undefined;
    try {
      validateEnv();
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message).toContain('DATABASE_URL');
    expect(caught?.message).toContain('vertex:');
  });

  it('is a no-op under NODE_ENV=test regardless of a malformed Vertex config', () => {
    vi.stubEnv('NODE_ENV', 'test');
    process.env.VERTEX_LOCATION = 'totally-not-a-location!!';

    expect(() => validateEnv()).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('is a no-op under CI=true regardless of a malformed Vertex config', () => {
    process.env.CI = 'true';
    process.env.VERTEX_MODEL = 'not a valid model id';

    expect(() => validateEnv()).not.toThrow();
  });
});
