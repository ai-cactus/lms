import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateTokens, truncateToContext, callVertexAI } from './ai-client';

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
  });

  describe('truncateToContext', () => {
    it('should return original text if within token limit', () => {
      const text = 'This is a short text.';
      expect(truncateToContext(text, 10)).toBe(text);
    });

    it('should truncate at sentence boundary if possible', () => {
      // 10 tokens * 4 = 40 characters
      const text = 'First sentence. Second sentence. Third sentence.';
      // "First sentence. Second sentence. " is 33 chars
      // "First sentence. Second sentence. Third" is 38 chars
      // Truncated at 40: "First sentence. Second sentence. Third s"
      // Last sentence end: ". " at index 14 and 31.
      // 31 is > 40 * 0.8 (32)? No, 31 is not > 32.
      // Wait, let's re-calculate.
      // maxChars = 40
      // truncated = text.substring(0, 40) -> "First sentence. Second sentence. Third s"
      // lastSentenceEnd:
      // index 14: ". "
      // index 31: ". "
      // lastSentenceEnd = 31
      // 31 > 32? No.
      // So it will cut at 40.

      const longText = 'This is a sentence. This is another sentence that is quite long.';
      // maxTokens = 10 -> maxChars = 40
      // truncated = "This is a sentence. This is another sent" (40 chars)
      // lastSentenceEnd: ". " at index 18
      // 18 > 32? No.
      // Returns "This is a sentence. This is another sent\n...[truncated]"

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

      (global.fetch as any).mockResolvedValue({
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

      (global.fetch as any)
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

      (global.fetch as any)
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
      (global.fetch as any).mockResolvedValue({
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
        ok: false,
      });

      const callPromise = callVertexAI('test');

      // Run all retries
      for (let i = 0; i < 5; i++) {
        await vi.runAllTimersAsync();
      }

      await expect(callPromise).rejects.toThrow(
        'Vertex AI 429 Too Many Requests: Rate limit exceeded',
      );
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('should throw on non-retryable errors (e.g., 400)', async () => {
      (global.fetch as any).mockResolvedValue({
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
  });
});
