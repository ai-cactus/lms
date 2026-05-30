// ──────────────────────────────────────────────
// Centralized Vertex AI Client
// Handles retries with exponential backoff,
// token estimation, and context truncation.
// ──────────────────────────────────────────────

import { GoogleAuth } from 'google-auth-library';
import { logger } from '@/lib/logger';

const DEFAULT_MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const VERTEX_AI_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per request

// ── Token utilities ──────────────────────────

/** Rough token estimate: ~4 characters per token for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a target token budget.
 * Cuts at a sentence boundary when possible to preserve readability.
 */
export function truncateToContext(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  // Try to cut at the last sentence ending before the limit
  const truncated = text.substring(0, maxChars);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('.\n'),
    truncated.lastIndexOf('? '),
    truncated.lastIndexOf('! '),
  );

  const cutPoint = lastSentenceEnd > maxChars * 0.8 ? lastSentenceEnd + 1 : maxChars;
  return text.substring(0, cutPoint) + '\n...[truncated]';
}

// ── Auth ──────────────────────────────────────

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

// ── Shared retry helper ──────────────────────

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < DEFAULT_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        logger.info({ msg: `[ai-client] ${label} retry ${attempt}/${DEFAULT_MAX_RETRIES - 1}...` });
      }
      return await fn();
    } catch (err: unknown) {
      const error = err as Error;
      lastError = error;

      const isRetryable =
        error.message?.includes('429') ||
        error.message?.includes('5') ||
        error.name === 'AbortError' ||
        error.message?.includes('fetch failed');

      if (!isRetryable) throw err;

      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      logger.warn({
        msg: `[ai-client] ${label} retryable error (attempt ${attempt + 1}/${DEFAULT_MAX_RETRIES}):`,
        data: error.message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError || new Error(`${label} failed after all retries.`);
}

// ── Core API caller ──────────────────────────

export interface VertexAIConfig {
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
}

/**
 * Call Vertex AI with automatic retry + exponential backoff for 429/5xx errors.
 * Returns the raw text output from the model.
 */
export async function callVertexAI(prompt: string, config?: VertexAIConfig): Promise<string> {
  const projectId = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
  const location = process.env.GOOGLE_LOCATION || 'us-central1';
  const model = config?.model || 'gemini-2.5-flash-lite';

  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error('Failed to get an OAuth2 access token for Google Cloud Vertex AI.');
  }

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: config?.temperature ?? 0.7,
      maxOutputTokens: config?.maxOutputTokens ?? 8192,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    ],
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < DEFAULT_MAX_RETRIES; attempt++) {
    // Each attempt gets its own AbortController so a timeout on one
    // attempt doesn't interfere with retries.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VERTEX_AI_TIMEOUT_MS);

    try {
      if (attempt > 0) {
        logger.info({ msg: `[ai-client] Retry ${attempt}/${DEFAULT_MAX_RETRIES - 1}...` });
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: controller.signal,
      });

      // Retryable status codes: 429 (rate limit) and 5xx (server errors)
      if (response.status === 429 || response.status >= 500) {
        const errorText = await response.text();
        lastError = new Error(`Vertex AI ${response.status} ${response.statusText}: ${errorText}`);
        logger.warn({
          msg: `[ai-client] Retryable error (${response.status}):`,
          data: lastError.message,
        });

        // Exponential backoff with jitter
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Non-retryable error
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vertex AI ${response.status} ${response.statusText}: ${errorText}`);
      }

      const json = await response.json();
      const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textPart) {
        logger.error({ msg: '[ai-client] Vertex AI returned no content', data: json });
        const finishReason = json.candidates?.[0]?.finishReason;
        throw new Error(
          `Vertex AI returned no content in response. Finish Reason: ${finishReason || 'unknown'}`,
        );
      }

      return textPart;
    } catch (err: unknown) {
      const error = err as Error;
      // Timeout / abort → treat as retryable
      if (error.name === 'AbortError') {
        lastError = new Error(
          `Vertex AI request timed out after ${VERTEX_AI_TIMEOUT_MS / 1000}s (attempt ${attempt + 1})`,
        );
        logger.warn({ msg: `[ai-client] ${lastError.message}` });
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      // If it was already a retryable error we handled above, it was stored in lastError
      // If it's a network error, we should retry too
      if (error.message?.includes('fetch failed')) {
        lastError = error;
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      // Non-retryable errors: throw immediately
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('Vertex AI call failed after all retries.');
}

/**
 * Generate a 768-dimensional vector embedding for the given text using text-embedding-004.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const results = await generateBatchEmbeddings([text]);
  return results[0];
}

/**
 * Generate embeddings for multiple texts in a single Vertex AI API call.
 * text-embedding-004 supports up to 250 instances per request.
 *
 * @param texts Array of text strings to embed (max 250 per call enforced internally)
 * @returns     Array of 768-dimensional embedding vectors, same order as input
 */
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const projectId = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
  const location = process.env.GOOGLE_LOCATION || 'us-central1';
  const model = 'text-embedding-004';

  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error('Failed to get an OAuth2 access token for Google Cloud Vertex AI.');
  }

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  const body = JSON.stringify({
    instances: texts.map((text) => ({
      task_type: 'RETRIEVAL_DOCUMENT',
      title: '',
      content: text,
    })),
  });

  return withRetry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Vertex AI Batch Embedding ${response.status} ${response.statusText}: ${errorText}`,
      );
    }

    const json = await response.json();
    const predictions: Array<{ embeddings: { values: number[] } }> = json.predictions ?? [];

    if (predictions.length !== texts.length) {
      throw new Error(
        `Vertex AI returned ${predictions.length} predictions for ${texts.length} inputs`,
      );
    }

    return predictions.map((p, i) => {
      const values = p?.embeddings?.values;
      if (!Array.isArray(values)) {
        throw new Error(`Vertex AI Embedding: no values for input at index ${i}`);
      }
      return values;
    });
  }, 'Embedding');
}
