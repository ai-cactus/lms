import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateTokens, truncateToContext, callVertexAI } from './ai-client';

describe('ai-client utilities', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens correctly (~4 chars per token)', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcdefgh')).toBe(2);
      expect(estimateTokens('abcde')).toBe(2); // Ceiling of 5/4
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('truncateToContext', () => {
    it('should return original text if within token limit', () => {
      const text = 'This is a short text.';
      expect(truncateToContext(text, 10)).toBe(text);
    });

    it('should truncate at sentence boundary if possible', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const longText = 'This is a sentence. This is another sentence that is quite long.';
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
  });

  describe('callVertexAI', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
      vi.useFakeTimers();
      process.env = { ...originalEnv, GEMINI_API_KEY: 'test-key' };
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      process.env = originalEnv;
    });

    it('should throw if API key is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      await expect(callVertexAI('test')).rejects.toThrow('Missing Gemini API Key');
    });

    it('should return text on successful response', async () => {
      const mockResponse = {
        candidates: [{ content: { parts: [{ text: 'AI response' }] } }],
      };

      (global.fetch as unknown as import('vitest').Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await callVertexAI('test prompt');
      expect(result).toBe('AI response');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          'publishers/google/models/gemini-2.5-flash-lite:generateContent?key=test-key',
        ),
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

      (global.fetch as unknown as import('vitest').Mock)
        .mockResolvedValueOnce({
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => 'Rate limit exceeded',
          ok: false,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        });

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

      (global.fetch as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error',
          ok: false,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        });

      const callPromise = callVertexAI('test');
      await vi.runAllTimersAsync();

      const result = await callPromise;
      expect(result).toBe('Success after 500');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error after maximum retries', async () => {
      (global.fetch as unknown as import('vitest').Mock).mockResolvedValue({
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
        ok: false,
      });

      const callPromise = callVertexAI('test');

      // Run all retries while catching the error to prevent unhandled rejection
      const errorPromise = callPromise.catch((e) => e);

      for (let i = 0; i < 5; i++) {
        await vi.runAllTimersAsync();
      }

      const error = await errorPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'Vertex AI 429 Too Many Requests: Rate limit exceeded',
      );
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('should retry on fetch failed network errors and eventually succeed', async () => {
      const mockSuccessResponse = {
        candidates: [{ content: { parts: [{ text: 'Success after network error' }] } }],
      };

      (global.fetch as unknown as import('vitest').Mock)
        .mockRejectedValueOnce(new Error('fetch failed: network disconnected'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSuccessResponse,
        });

      const callPromise = callVertexAI('test');

      // Advance timers to trigger retry
      await vi.runAllTimersAsync();

      const result = await callPromise;
      expect(result).toBe('Success after network error');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw on non-retryable errors (e.g., 400)', async () => {
      (global.fetch as unknown as import('vitest').Mock).mockResolvedValue({
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid prompt',
        ok: false,
      });

      await expect(callVertexAI('test')).rejects.toThrow(
        'Vertex AI 400 Bad Request: Invalid prompt',
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw immediately on non-fetch-failed exceptions', async () => {
      (global.fetch as unknown as import('vitest').Mock).mockRejectedValueOnce(
        new Error('SyntaxError: Unexpected token'),
      );

      await expect(callVertexAI('test')).rejects.toThrow('SyntaxError: Unexpected token');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
