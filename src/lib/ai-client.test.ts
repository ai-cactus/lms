/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateTokens,
  truncateToContext,
  callVertexAI,
  generateBatchEmbeddings,
  interactiveBudget,
  INTERACTIVE_VERTEX_BUDGET_MS,
  VertexBudgetExceededError,
} from './ai-client';

vi.mock('google-auth-library', () => {
  return {
    GoogleAuth: class MockGoogleAuth {
      async getAccessToken() {
        return 'test-token';
      }
    },
  };
});

describe('ai-client utilities', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens correctly for basic ASCII strings', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcde')).toBe(2); // Ceiling of 5/4
      expect(estimateTokens('abcdefgh')).toBe(2);
    });

    it('should return exactly 1 token for boundary conditions (1-4 characters)', () => {
      expect(estimateTokens('a')).toBe(1);
      expect(estimateTokens('ab')).toBe(1);
      expect(estimateTokens('abc')).toBe(1);
      expect(estimateTokens('abcd')).toBe(1);
    });

    it('should handle strings with only whitespace', () => {
      expect(estimateTokens(' ')).toBe(1);
      expect(estimateTokens('    ')).toBe(1);
      expect(estimateTokens('     ')).toBe(2);
      expect(estimateTokens('\n\t\r ')).toBe(1);
    });

    it('should handle strings with special characters and punctuation', () => {
      expect(estimateTokens('!@#$')).toBe(1);
      expect(estimateTokens('!@#$%')).toBe(2);
      expect(estimateTokens('hello, world!')).toBe(4); // 13 chars
    });

    it('should handle very long strings', () => {
      const longString = 'A'.repeat(4000); // 4000 chars
      expect(estimateTokens(longString)).toBe(1000);

      const longerString = 'A'.repeat(4001); // 4001 chars
      expect(estimateTokens(longerString)).toBe(1001);
    });

    it('should handle non-ASCII characters and emojis', () => {
      // Emojis often have length > 1 due to surrogate pairs, which is fine since the function uses .length
      expect(estimateTokens('こんにちは')).toBe(2); // 5 chars
      expect(estimateTokens('😊')).toBe(1); // Usually length 2 in JS
      expect(estimateTokens('👨‍👩‍👧‍👦')).toBe(3); // Usually length 11 in JS
    });

    it('should handle strings with only numbers', () => {
      expect(estimateTokens('1234')).toBe(1);
      expect(estimateTokens('12345')).toBe(2);
      expect(estimateTokens('00000000')).toBe(2);
    });

    it('should handle strings with mixed whitespace and content', () => {
      expect(estimateTokens('a b c d')).toBe(2); // 7 chars
      expect(estimateTokens('  hello  ')).toBe(3); // 9 chars
      expect(estimateTokens(' line1\nline2 ')).toBe(4); // 13 chars
    });

    it('should approximate well for a long string', () => {
      const longString = 'a'.repeat(4000);
      expect(estimateTokens(longString)).toBe(1000);

      const irregularLongString = 'abcd'.repeat(1000) + 'ef';
      // 4002 characters -> 4002 / 4 = 1000.5 -> ceil = 1001
      expect(estimateTokens(irregularLongString)).toBe(1001);
    });

    it('should handle whitespace and special characters', () => {
      expect(estimateTokens('    ')).toBe(1); // 4 spaces
      expect(estimateTokens('\n\n\n\n')).toBe(1); // 4 newlines
      expect(estimateTokens('👨‍👩‍👧‍👦')).toBe(3); // emoji chars, length is 11
    });
  });

  describe('truncateToContext', () => {
    it('should return original text if within token limit', () => {
      const text = 'This is a short text.';
      expect(truncateToContext(text, 10)).toBe(text);
    });

    it('should return original text if exactly at token limit', () => {
      const text = 'A'.repeat(40);
      expect(truncateToContext(text, 10)).toBe(text);
    });

    it('should return original text if shorter than token limit', () => {
      const text = 'A'.repeat(39);
      expect(truncateToContext(text, 10)).toBe(text);
    });

    it('should return empty string if input is empty', () => {
      expect(truncateToContext('', 10)).toBe('');
    });

    it('should truncate to 0 characters if maxTokens is 0 or negative', () => {
      const text = 'Some text here.';
      expect(truncateToContext(text, 0)).toBe('\n...[truncated]');
      expect(truncateToContext(text, -5)).toBe('\n...[truncated]');
    });

    it('should truncate text with only whitespace properly', () => {
      const text = ' '.repeat(50);
      expect(truncateToContext(text, 10)).toBe(' '.repeat(40) + '\n...[truncated]');
    });

    it('should truncate at sentence boundary if possible', () => {
      // 10 tokens * 4 = 40 characters
      // text length needs to be considered for testing boundary cases

      const textWithBoundary = 'Hello world. This is a test. Another sentence.';
      // maxTokens = 8 -> maxChars = 32
      // truncated = "Hello world. This is a test. Ano" (32 chars)
      // lastSentenceEnd: ". " at index 11 and 27
      // 27 > 32 * 0.8 (25.6)? Yes.
      // cutPoint = 27 + 1 = 28
      // returns text.substring(0, 28) + '\n...[truncated]'
      // "Hello world. This is a test." + '\n...[truncated]'

      const result = truncateToContext(textWithBoundary, 8);
      expect(result).toContain('Hello world. This is a test.');
      expect(result).toContain('...[truncated]');
      expect(result.length).toBeLessThan(textWithBoundary.length);
    });

    it('should truncate at character limit if no sentence boundary is near', () => {
      const text = 'A'.repeat(100);
      const result = truncateToContext(text, 10); // 40 chars
      expect(result).toBe('A'.repeat(40) + '\n...[truncated]');
    });

    it('should handle exactly max characters without truncating', () => {
      const text = 'A'.repeat(40);
      const result = truncateToContext(text, 10); // exactly 40 chars
      expect(result).toBe(text);
    });

    it('should handle 0 maxTokens', () => {
      const text = 'Some long text';
      const result = truncateToContext(text, 0);
      expect(result).toBe('\n...[truncated]');
    });

    it('should handle negative maxTokens', () => {
      const text = 'Some long text';
      const result = truncateToContext(text, -5);
      expect(result).toBe('\n...[truncated]');
    });

    it('should handle empty string input', () => {
      expect(truncateToContext('', 10)).toBe('');
      expect(truncateToContext('', 0)).toBe('');
      // For negative maxTokens, maxChars becomes negative.
      // text.length (0) <= maxChars (-20) is false.
      // So it executes the truncation logic:
      // text.substring(0, cutPoint) + '\n...[truncated]'
      // yielding '\n...[truncated]' for empty string when maxTokens is negative!
      expect(truncateToContext('', -5)).toBe('\n...[truncated]');
    });
  });

  describe('callVertexAI', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
      vi.useFakeTimers();
      process.env = { ...originalEnv };
      // Set explicitly: these tests previously passed only because the client
      // fell back to the hardcoded production project when this was unset.
      process.env.GOOGLE_PROJECT_ID = 'test-project';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      process.env = originalEnv;
    });

    it('should use OAuth Bearer token instead of API key', async () => {
      const mockResponse = {
        candidates: [{ content: { parts: [{ text: 'AI response' }] } }],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as any);

      await callVertexAI('test prompt');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('publishers/google/models/gemini-2.5-flash-lite:generateContent'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).not.toContain('key=');
    });

    it('should return text on successful response', async () => {
      const mockResponse = {
        candidates: [{ content: { parts: [{ text: 'AI response' }] } }],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await callVertexAI('test prompt');
      expect(result).toBe('AI response');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('publishers/google/models/gemini-2.5-flash-lite:generateContent'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test prompt'),
        }),
      );
    });

    it('should retry on 429 errors and eventually succeed', async () => {
      const mockSuccessResponse = {
        candidates: [{ content: { parts: [{ text: 'Success after retry' }] } }],
      };

      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => 'Rate limit exceeded',
          ok: false,
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        } as any);

      const callPromise = callVertexAI('test');

      // Advance timers to trigger retry
      await vi.runAllTimersAsync();

      const result = await callPromise;
      expect(result).toBe('Success after retry');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx errors', async () => {
      const mockSuccessResponse = {
        candidates: [{ content: { parts: [{ text: 'Success after 500' }] } }],
      };

      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error',
          ok: false,
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        } as any);

      const callPromise = callVertexAI('test');
      await vi.runAllTimersAsync();

      const result = await callPromise;
      expect(result).toBe('Success after 500');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on fetch failed errors and eventually succeed', async () => {
      const mockSuccessResponse = {
        candidates: [{ content: { parts: [{ text: 'Success after fetch failed' }] } }],
      };

      (global.fetch as any)
        .mockRejectedValueOnce(new Error('fetch failed: network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        });

      const callPromise = callVertexAI('test');
      await vi.runAllTimersAsync();

      const result = await callPromise;
      expect(result).toBe('Success after fetch failed');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error after maximum retries', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
        ok: false,
      } as any);

      const callPromise = callVertexAI('test').catch((e) => e);

      // Run all retries while catching the error to prevent unhandled rejection
      callPromise.catch((e) => e);

      for (let i = 0; i < 5; i++) {
        await vi.runAllTimersAsync();
      }

      const error = await callPromise;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Vertex AI 429 Too Many Requests: Rate limit exceeded');
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('should retry on fetch failed network errors and eventually succeed', async () => {
      const mockSuccessResponse = {
        candidates: [{ content: { parts: [{ text: 'Success after network error' }] } }],
      };

      vi.mocked(global.fetch)
        .mockRejectedValueOnce(new Error('fetch failed: network disconnected'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        } as any);

      const callPromise = callVertexAI('test');

      // Advance timers to trigger retry
      await vi.runAllTimersAsync();

      const result = await callPromise;
      expect(result).toBe('Success after network error');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    it('should throw immediately on unknown network errors (without fetch failed)', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Unknown network issue'));

      const callPromise = callVertexAI('test');

      await expect(callPromise).rejects.toThrow('Unknown network issue');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw on non-retryable errors (e.g., 400)', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid prompt',
        ok: false,
      } as any);

      await expect(callVertexAI('test')).rejects.toThrow(
        'Vertex AI 400 Bad Request: Invalid prompt',
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw immediately on non-fetch-failed exceptions', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('SyntaxError: Unexpected token'));

      await expect(callVertexAI('test')).rejects.toThrow('SyntaxError: Unexpected token');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on "fetch failed" network errors and eventually succeed', async () => {
      const mockSuccessResponse = {
        candidates: [{ content: { parts: [{ text: 'Success after network failure' }] } }],
      };

      vi.mocked(global.fetch)
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        } as any);

      const callPromise = callVertexAI('test network error');
      await vi.runAllTimersAsync();

      const result = await callPromise;
      expect(result).toBe('Success after network failure');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error when Vertex AI returns no content in response', async () => {
      const mockEmptyResponse = {
        candidates: [{ content: { parts: [] } }],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockEmptyResponse,
      } as any);

      await expect(callVertexAI('test empty')).rejects.toThrow(
        'Vertex AI returned no content in response.',
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should pass custom configuration to the API payload', async () => {
      const mockSuccessResponse = {
        candidates: [{ content: { parts: [{ text: 'Config test response' }] } }],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockSuccessResponse,
      } as any);

      const config = {
        temperature: 0.2,
        maxOutputTokens: 1000,
        model: 'custom-model-test',
      };

      await callVertexAI('test config', config);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('publishers/google/models/custom-model-test:generateContent'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"temperature":0.2'),
        }),
      );

      const fetchCall = (global.fetch as any).mock.calls[0];
      const fetchBody = JSON.parse(fetchCall[1].body);
      expect(fetchBody.generationConfig.maxOutputTokens).toBe(1000);
      expect(fetchBody.generationConfig.temperature).toBe(0.2);
    });
  });

  /**
   * Regression cover for the Cloudflare 524 on "Generate with AI".
   *
   * The retry ladder (5 attempts, 1s→16s backoff, 5 minutes per attempt) has no
   * wall-clock ceiling of its own, so against a slow or rate-limiting Vertex it
   * can hold a request open far past the ~100s at which the gateway gives up.
   * On a browser-awaited Server Action that surfaced as a 524 — a network
   * failure with no status and no reason.
   *
   * These pin the deadline itself rather than an attempt count: an attempt
   * count still lets one slow response outlast the window.
   */
  describe('interactive retry budget', () => {
    const originalEnv = process.env;

    /**
     * A Vertex that takes `delayMs` to answer and honours the AbortSignal, so
     * the clamped per-attempt timeout is exercised the way a real fetch would
     * exercise it.
     */
    const slowFetch = (delayMs: number, respond: () => unknown) =>
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(respond()), delayMs);
            init.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const abortError = new Error('The operation was aborted.');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          }),
      );

    const serviceUnavailable = () => ({
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'upstream unavailable',
      ok: false,
    });

    beforeEach(() => {
      vi.useFakeTimers();
      process.env = { ...originalEnv };
      process.env.GOOGLE_PROJECT_ID = 'test-project';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      process.env = originalEnv;
    });

    it('gives up inside the budget when Vertex is slow and failing', async () => {
      // 20s per attempt: enough that the unbudgeted ladder (5 × 20s of request
      // plus 31s of backoff ≈ 131s) sails past the gateway's ~100s cut.
      vi.stubGlobal('fetch', slowFetch(20_000, serviceUnavailable));

      const startedAt = Date.now();
      const call = callVertexAI('test', { retry: interactiveBudget() }).catch((e: Error) => e);
      await vi.runAllTimersAsync();
      const error = await call;

      expect(error).toBeInstanceOf(VertexBudgetExceededError);
      expect(Date.now() - startedAt).toBeLessThanOrEqual(INTERACTIVE_VERTEX_BUDGET_MS);
      // It stopped because time ran out, not because it used up its attempts.
      expect(vi.mocked(global.fetch).mock.calls.length).toBeLessThan(5);
    });

    it('aborts an attempt that would itself outlast the budget', async () => {
      // One attempt, slower than the whole budget. An attempt *count* would not
      // save this request; only the deadline does.
      vi.stubGlobal('fetch', slowFetch(120_000, serviceUnavailable));

      const startedAt = Date.now();
      const call = callVertexAI('test', { retry: interactiveBudget() }).catch((e: Error) => e);
      await vi.runAllTimersAsync();
      const error = await call;

      expect(error).toBeInstanceOf(VertexBudgetExceededError);
      expect(Date.now() - startedAt).toBeLessThanOrEqual(INTERACTIVE_VERTEX_BUDGET_MS);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('still succeeds inside the budget when Vertex recovers', async () => {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(slowFetch(5_000, serviceUnavailable))
        .mockImplementationOnce(
          slowFetch(5_000, () => ({
            ok: true,
            json: async () => ({ candidates: [{ content: { parts: [{ text: 'recovered' }] } }] }),
          })),
        );
      vi.stubGlobal('fetch', fetchMock);

      const call = callVertexAI('test', { retry: interactiveBudget() });
      await vi.runAllTimersAsync();

      await expect(call).resolves.toBe('recovered');
    });

    it('leaves callers without a budget on the full background-job ladder', async () => {
      // The control for the tests above, and the guard on the ⛔ in the brief:
      // narrowing the async job paths would trade a visible failure for an
      // invisible one, so an omitted budget must still spend the whole ladder.
      vi.stubGlobal('fetch', slowFetch(20_000, serviceUnavailable));

      const startedAt = Date.now();
      const call = callVertexAI('test').catch((e: Error) => e);
      await vi.runAllTimersAsync();
      const error = await call;

      expect(error).not.toBeInstanceOf(VertexBudgetExceededError);
      expect(global.fetch).toHaveBeenCalledTimes(5);
      expect(Date.now() - startedAt).toBeGreaterThan(INTERACTIVE_VERTEX_BUDGET_MS);
    });

    it('bounds generateBatchEmbeddings the same way', async () => {
      vi.stubGlobal('fetch', slowFetch(20_000, serviceUnavailable));

      const startedAt = Date.now();
      const call = generateBatchEmbeddings(['text'], interactiveBudget()).catch((e: Error) => e);
      await vi.runAllTimersAsync();
      const error = await call;

      expect(error).toBeInstanceOf(VertexBudgetExceededError);
      expect(Date.now() - startedAt).toBeLessThanOrEqual(INTERACTIVE_VERTEX_BUDGET_MS);
    });
  });

  describe('GOOGLE_PROJECT_ID is required (no production fallback)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.env = originalEnv;
    });

    /**
     * Regression guard. `ai-client.ts` used to read
     *   process.env.GOOGLE_PROJECT_ID || 'theraptly-lms'
     * so any environment without the variable set silently issued its Vertex
     * calls against the PRODUCTION project, authenticated by the host's
     * Application Default Credentials. Nothing in the env files revealed it.
     */
    it('callVertexAI throws when GOOGLE_PROJECT_ID is unset, rather than defaulting', async () => {
      delete process.env.GOOGLE_PROJECT_ID;

      await expect(callVertexAI('prompt')).rejects.toThrow(/GOOGLE_PROJECT_ID is not set/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('callVertexAI throws when GOOGLE_PROJECT_ID is empty', async () => {
      process.env.GOOGLE_PROJECT_ID = '';

      await expect(callVertexAI('prompt')).rejects.toThrow(/GOOGLE_PROJECT_ID is not set/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('generateBatchEmbeddings throws when GOOGLE_PROJECT_ID is unset', async () => {
      delete process.env.GOOGLE_PROJECT_ID;

      await expect(generateBatchEmbeddings(['some text'])).rejects.toThrow(
        /GOOGLE_PROJECT_ID is not set/,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never falls back to the production project name', async () => {
      delete process.env.GOOGLE_PROJECT_ID;

      const error = await callVertexAI('prompt').catch((e: Error) => e);
      expect((error as Error).message).not.toContain('theraptly-lms');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('uses the configured project in the request URL when set', async () => {
      process.env.GOOGLE_PROJECT_ID = 'theraptly-lms-staging';
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
      } as any);

      await callVertexAI('prompt');

      const url = (global.fetch as any).mock.calls[0][0] as string;
      expect(url).toContain('/projects/theraptly-lms-staging/');
      expect(url).not.toContain('/projects/theraptly-lms/');
    });
  });
});
