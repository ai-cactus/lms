/**
 * The prompts sent to Vertex are assembled from facility-uploaded source
 * documents. PostHog's $ai_generation schema has fields designed to carry them
 * ($ai_input, $ai_output_choices) and its own SDKs populate them by default.
 * These tests exist to prove ours never does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCaptureServer } = vi.hoisted(() => ({ mockCaptureServer: vi.fn() }));
vi.mock('@/lib/analytics/server', () => ({ captureServer: mockCaptureServer }));

import { captureGeneration, classifyAiError } from './llm';
import { runWithAiContext } from './ai-context';

const RUN = { traceId: 'job-1', distinctId: 'user-1', organizationId: 'org-9' };

const BASE = {
  telemetry: { stage: 'article' } as const,
  model: 'gemini-2.5-flash-lite',
  latencyMs: 2400,
  inputTokens: 1200,
  outputTokens: 800,
  attempt: 0,
};

const propsOf = () => mockCaptureServer.mock.calls[0][1];

beforeEach(() => vi.clearAllMocks());

describe('captureGeneration', () => {
  it('emits $ai_generation with the trace and identity from the run context', async () => {
    await runWithAiContext(RUN, async () => captureGeneration(BASE));

    expect(mockCaptureServer).toHaveBeenCalledTimes(1);
    const [event, properties, context] = mockCaptureServer.mock.calls[0];
    expect(event).toBe('$ai_generation');
    expect(properties.$ai_trace_id).toBe('job-1');
    expect(properties.$ai_span_name).toBe('article');
    expect(context).toEqual({ distinctId: 'user-1', organizationId: 'org-9' });
  });

  /**
   * PostHog's taxonomy documents $ai_latency as seconds ("in seconds",
   * example 0.361). Call sites measure in ms because that is what Date.now()
   * gives, so the conversion happens here — and a regression would silently
   * inflate every latency dashboard 1000x.
   */
  it('converts latency from milliseconds to seconds', async () => {
    await runWithAiContext(RUN, async () => captureGeneration({ ...BASE, latencyMs: 2400 }));
    expect(propsOf().$ai_latency).toBe(2.4);
  });

  it('reports the exact token counts Vertex returned', async () => {
    await runWithAiContext(RUN, async () => captureGeneration(BASE));
    expect(propsOf().$ai_input_tokens).toBe(1200);
    expect(propsOf().$ai_output_tokens).toBe(800);
  });

  it('records a failure with a classified reason, not the raw error', async () => {
    await runWithAiContext(RUN, async () =>
      captureGeneration({
        ...BASE,
        error: new Error('Vertex AI 429 rate limit: prompt was "Patient John Doe, DOB 01/02/1970"'),
      }),
    );

    const properties = propsOf();
    expect(properties.$ai_is_error).toBe(true);
    expect(properties.$ai_error_type).toBe('rate_limit');
    expect(JSON.stringify(properties)).not.toContain('John Doe');
    expect(JSON.stringify(properties)).not.toContain('01/02/1970');
  });

  it('marks a successful generation as not an error', async () => {
    await runWithAiContext(RUN, async () => captureGeneration({ ...BASE, finishReason: 'STOP' }));
    expect(propsOf().$ai_is_error).toBe(false);
    expect(propsOf().$ai_error_type).toBeNull();
    expect(propsOf().$ai_stop_reason).toBe('STOP');
  });

  /* ── The prompt must never leave the process ───────────────────────────── */

  it('never emits any property carrying prompt or completion text', async () => {
    await runWithAiContext(RUN, async () => captureGeneration(BASE));

    const keys = Object.keys(propsOf());
    expect(keys).not.toContain('$ai_input');
    expect(keys).not.toContain('$ai_output');
    expect(keys).not.toContain('$ai_output_choices');
    expect(keys).not.toContain('$ai_user_prompt');
    expect(keys).not.toContain('$ai_error');
  });

  it('emits only the known-safe property set', async () => {
    await runWithAiContext(RUN, async () => captureGeneration(BASE));

    expect(Object.keys(propsOf()).sort()).toEqual(
      [
        '$ai_error_type',
        '$ai_input_tokens',
        '$ai_is_error',
        '$ai_latency',
        '$ai_model',
        '$ai_output_tokens',
        '$ai_provider',
        '$ai_span_name',
        '$ai_stop_reason',
        '$ai_trace_id',
        'attempt',
      ].sort(),
    );
  });

  /* ── No context means no event ─────────────────────────────────────────── */

  it('records nothing outside a run context rather than inventing an identity', () => {
    captureGeneration(BASE);
    expect(mockCaptureServer).not.toHaveBeenCalled();
  });

  it('keeps separate concurrent generations on separate traces', async () => {
    await Promise.all([
      runWithAiContext({ ...RUN, traceId: 'job-A' }, async () => captureGeneration(BASE)),
      runWithAiContext({ ...RUN, traceId: 'job-B' }, async () => captureGeneration(BASE)),
    ]);

    const traceIds = mockCaptureServer.mock.calls.map((call) => call[1].$ai_trace_id).sort();
    expect(traceIds).toEqual(['job-A', 'job-B']);
  });
});

describe('classifyAiError', () => {
  it.each([
    ['Vertex AI request timed out after 300s (attempt 1)', 'timeout'],
    ['Vertex AI 429 Too Many Requests', 'rate_limit'],
    ['Vertex AI 503 Service Unavailable', 'server_error'],
    ['fetch failed', 'server_error'],
    ['Vertex AI returned no content in response. Finish Reason: SAFETY', 'no_content'],
    ['something nobody anticipated', 'unknown'],
  ])('classifies %s', (message, expected) => {
    expect(classifyAiError(new Error(message))).toBe(expected);
  });

  it('handles a non-Error throw without blowing up', () => {
    expect(classifyAiError('just a string')).toBe('unknown');
    expect(classifyAiError(null)).toBe('unknown');
  });
});
