/**
 * posthog-node has NO before_send hook, so this module is the only egress guard
 * on the server side. These tests hold that guard in place.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCapture, mockGroupIdentify, mockShutdown, PostHogMock } = vi.hoisted(() => {
  const mockCapture = vi.fn();
  const mockGroupIdentify = vi.fn();
  const mockShutdown = vi.fn().mockResolvedValue(undefined);
  return {
    mockCapture,
    mockGroupIdentify,
    mockShutdown,
    // A `function`, not an arrow: the module calls `new PostHog(...)`, and an
    // arrow function is not a constructor.
    PostHogMock: vi.fn(function () {
      return { capture: mockCapture, groupIdentify: mockGroupIdentify, shutdown: mockShutdown };
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
  delete (globalThis as { posthogServer?: unknown }).posthogServer;
  return import('./server');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
});

describe('captureServer', () => {
  it('sends a declared event with the org attached as a group', async () => {
    const { captureServer } = await loadModule();

    captureServer(
      'course_published',
      { lesson_count: 4, has_quiz: true, has_video: false },
      CONTEXT,
    );

    expect(mockCapture).toHaveBeenCalledTimes(1);
    const call = mockCapture.mock.calls[0][0];
    expect(call.event).toBe('course_published');
    expect(call.distinctId).toBe('user-1');
    // Group analytics is what makes per-customer adoption measurable on a
    // multi-tenant app; without this every event is org-less.
    expect(call.groups).toEqual({ organization: 'org-9' });
  });

  it('omits groups entirely when the session has no organization', async () => {
    const { captureServer } = await loadModule();

    captureServer('signup_started', { entry_point: 'marketing' }, { distinctId: 'user-1' });

    expect(mockCapture.mock.calls[0][0].groups).toBeUndefined();
  });

  it('runs properties through the sanitiser', async () => {
    const { captureServer } = await loadModule();

    captureServer(
      'login_failed',
      // Cast: the point is to prove the RUNTIME guard holds even when a call site
      // subverts the compile-time one.
      { portal: 'admin', reason: 'bad_credentials', note: 'nurse@clinic.com' } as never,
      CONTEXT,
    );

    const properties = mockCapture.mock.calls[0][0].properties;
    expect(JSON.stringify(properties)).not.toContain('nurse@clinic.com');
  });

  it('drops an event that is not on the allowlist', async () => {
    const { captureServer } = await loadModule();

    captureServer('totally_made_up' as never, {} as never, CONTEXT);

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('is completely inert with no PostHog key configured', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { captureServer } = await loadModule();

    captureServer(
      'course_published',
      { lesson_count: 1, has_quiz: false, has_video: false },
      CONTEXT,
    );

    expect(PostHogMock).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('reuses one client across calls rather than opening one per event', async () => {
    const { captureServer } = await loadModule();

    captureServer('signup_started', { entry_point: 'direct' }, CONTEXT);
    captureServer('signup_submitted', { used_captcha: false }, CONTEXT);

    expect(PostHogMock).toHaveBeenCalledTimes(1);
  });

  /* ── Telemetry must never break the operation it measures ──────────────── */

  it('swallows a transport failure instead of failing the caller', async () => {
    const { captureServer } = await loadModule();
    mockCapture.mockImplementationOnce(() => {
      throw new Error('network down');
    });

    expect(() =>
      captureServer(
        'course_published',
        { lesson_count: 1, has_quiz: false, has_video: false },
        CONTEXT,
      ),
    ).not.toThrow();
  });

  it('swallows a throwing property thunk instead of failing the caller', async () => {
    const { captureServer } = await loadModule();

    // This is the real-world shape: a derivation over a relation that a changed
    // query made undefined. It must not take the publish action down with it.
    expect(() =>
      captureServer(
        'course_published',
        () => {
          const lessons = undefined as unknown as { quiz: unknown }[];
          return { lesson_count: lessons.length, has_quiz: false, has_video: false };
        },
        CONTEXT,
      ),
    ).not.toThrow();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('resolves a thunk to the same payload a literal would produce', async () => {
    const { captureServer } = await loadModule();

    captureServer(
      'course_published',
      () => ({ lesson_count: 3, has_quiz: true, has_video: true }),
      CONTEXT,
    );

    expect(mockCapture.mock.calls[0][0].properties).toMatchObject({
      lesson_count: 3,
      has_quiz: true,
      has_video: true,
    });
  });
});

describe('shutdownAnalytics', () => {
  it('flushes the queue so a deploy does not discard batched events', async () => {
    const { captureServer, shutdownAnalytics } = await loadModule();
    captureServer('signup_started', { entry_point: 'direct' }, CONTEXT);

    await shutdownAnalytics();

    expect(mockShutdown).toHaveBeenCalledTimes(1);
  });

  it('does not reject when the flush fails, so shutdown continues', async () => {
    const { captureServer, shutdownAnalytics } = await loadModule();
    captureServer('signup_started', { entry_point: 'direct' }, CONTEXT);
    mockShutdown.mockRejectedValueOnce(new Error('flush timeout'));

    await expect(shutdownAnalytics()).resolves.toBeUndefined();
  });

  it('is a no-op when analytics was never initialised', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { shutdownAnalytics } = await loadModule();

    await expect(shutdownAnalytics()).resolves.toBeUndefined();
    expect(mockShutdown).not.toHaveBeenCalled();
  });
});

describe('identifyOrganization', () => {
  it('sets the org group properties used for churn cohorts', async () => {
    const { identifyOrganization } = await loadModule();

    identifyOrganization({ organizationId: 'org-9', name: 'Cedar Ridge', plan: 'scale' });

    expect(mockGroupIdentify).toHaveBeenCalledWith({
      groupType: 'organization',
      groupKey: 'org-9',
      properties: { name: 'Cedar Ridge', plan: 'scale' },
    });
  });
});
