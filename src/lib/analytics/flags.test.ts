/**
 * The property that matters here is not "flags work" — it is that PostHog being
 * slow, broken, or absent NEVER changes what the app does beyond falling back to
 * a declared default. A flag lookup may degrade; a page may not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetFeatureFlag, PostHogMock } = vi.hoisted(() => {
  const mockGetFeatureFlag = vi.fn();
  return {
    mockGetFeatureFlag,
    PostHogMock: vi.fn(function () {
      return { getFeatureFlag: mockGetFeatureFlag, shutdown: vi.fn().mockResolvedValue(undefined) };
    }),
  };
});

vi.mock('posthog-node', () => ({ PostHog: PostHogMock }));
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

const CONTEXT = { distinctId: 'user-1', organizationId: 'org-9' };

async function loadModule() {
  vi.resetModules();
  delete (globalThis as { posthogFlags?: unknown }).posthogFlags;
  return import('./flags');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  vi.useRealTimers();
});

describe('getFeatureFlag', () => {
  it('returns the value PostHog resolved', async () => {
    const { getFeatureFlag } = await loadModule();
    mockGetFeatureFlag.mockResolvedValue(true);

    await expect(getFeatureFlag('onboarding-step3-variant', CONTEXT)).resolves.toBe(true);
  });

  it('passes the org as a group so a flag can roll out per customer', async () => {
    const { getFeatureFlag } = await loadModule();
    mockGetFeatureFlag.mockResolvedValue(false);

    await getFeatureFlag('document-hub-redesign', CONTEXT);

    expect(mockGetFeatureFlag).toHaveBeenCalledWith('document-hub-redesign', 'user-1', {
      groups: { organization: 'org-9' },
    });
  });

  /* ── Failure must never propagate ──────────────────────────────────────── */

  it('falls back to the default when evaluation throws', async () => {
    const { getFeatureFlag, FLAG_DEFAULTS } = await loadModule();
    mockGetFeatureFlag.mockRejectedValue(new Error('posthog is down'));

    await expect(getFeatureFlag('onboarding-step3-variant', CONTEXT)).resolves.toBe(
      FLAG_DEFAULTS['onboarding-step3-variant'],
    );
  });

  it('falls back to the default rather than hanging the render', async () => {
    const { getFeatureFlag, FLAG_DEFAULTS } = await loadModule();
    // Never settles — the shape of a PostHog outage that accepts the connection
    // but never answers, which is worse than an outright refusal.
    mockGetFeatureFlag.mockReturnValue(new Promise(() => {}));

    await expect(getFeatureFlag('video-course-catalog', CONTEXT)).resolves.toBe(
      FLAG_DEFAULTS['video-course-catalog'],
    );
  }, 10_000);

  it('falls back when analytics is disabled entirely', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { getFeatureFlag, FLAG_DEFAULTS } = await loadModule();

    await expect(getFeatureFlag('document-hub-redesign', CONTEXT)).resolves.toBe(
      FLAG_DEFAULTS['document-hub-redesign'],
    );
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  // A multivariate flag returns a variant STRING. Coercing that to a boolean
  // would make every variant truthy — i.e. silently on for everyone.
  it('falls back when PostHog returns a variant string, not a boolean', async () => {
    const { getFeatureFlag, FLAG_DEFAULTS } = await loadModule();
    mockGetFeatureFlag.mockResolvedValue('control');

    await expect(getFeatureFlag('onboarding-step3-variant', CONTEXT)).resolves.toBe(
      FLAG_DEFAULTS['onboarding-step3-variant'],
    );
  });

  it('falls back when the flag does not exist in PostHog', async () => {
    const { getFeatureFlag, FLAG_DEFAULTS } = await loadModule();
    mockGetFeatureFlag.mockResolvedValue(undefined);

    await expect(getFeatureFlag('video-course-catalog', CONTEXT)).resolves.toBe(
      FLAG_DEFAULTS['video-course-catalog'],
    );
  });
});

describe('FLAG_DEFAULTS', () => {
  /**
   * An outage should look like "the new thing hasn't reached me yet", never
   * like an unreviewed feature switching itself on for every customer at once.
   */
  it('defaults every flag to off', async () => {
    const { FLAG_DEFAULTS } = await loadModule();
    for (const [key, value] of Object.entries(FLAG_DEFAULTS)) {
      expect(value, `${key} should default to false`).toBe(false);
    }
  });

  // These are read at boot in instrumentation.ts and must work when PostHog is
  // unreachable. A kill-switch that depends on a third party is not one.
  it('does not contain the infrastructure kill-switches', async () => {
    const { FLAG_DEFAULTS } = await loadModule();
    const keys = Object.keys(FLAG_DEFAULTS).join(',').toLowerCase();

    expect(keys).not.toContain('sweep');
    expect(keys).not.toContain('digest');
    expect(keys).not.toContain('reminder');
  });
});

describe('getAllFlags', () => {
  it('resolves every declared flag for client bootstrapping', async () => {
    const { getAllFlags, FLAG_DEFAULTS } = await loadModule();
    mockGetFeatureFlag.mockResolvedValue(false);

    const flags = await getAllFlags(CONTEXT);

    expect(Object.keys(flags).sort()).toEqual(Object.keys(FLAG_DEFAULTS).sort());
  });

  it('still returns a complete map when one flag fails', async () => {
    const { getAllFlags, FLAG_DEFAULTS } = await loadModule();
    mockGetFeatureFlag.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(false);

    const flags = await getAllFlags(CONTEXT);

    expect(Object.keys(flags)).toHaveLength(Object.keys(FLAG_DEFAULTS).length);
  });
});
