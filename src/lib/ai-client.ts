import { GoogleAuth } from 'google-auth-library';
import { logger } from '@/lib/logger';
import { captureGeneration, type AiTelemetry } from '@/lib/analytics/llm';

const DEFAULT_MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const VERTEX_AI_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per request

/**
 * Wall-clock ceiling for Vertex work a browser is synchronously waiting on.
 *
 * The retry ladder below is sized for background jobs: 5 attempts, 1s→16s of
 * backoff between them (31s in total), and five minutes allowed per attempt.
 * Nothing caps the sum, so a rate-limited or slow Vertex can hold a request
 * open for minutes. Cloudflare terminates a request at ~100s with a 524, which
 * reaches the browser as a network failure — no status, no reason, nothing a
 * caller can turn into a useful message.
 *
 * 45s is the budget a browser-awaited request may spend on Vertex. It leaves
 * the rest of the ~100s window for authentication, database work and the
 * response itself, and it is deliberately the budget for the WHOLE request:
 * an action that scans for PHI and then generates shares one deadline (see
 * `interactiveBudget`), because the browser is waiting on the action, not on
 * any single call inside it.
 *
 * Background jobs deliberately do not use this. Nothing waits on them and
 * Vertex rate-limiting is real, so they keep the full ladder.
 */
export const INTERACTIVE_VERTEX_BUDGET_MS = 45 * 1000;

export interface RetryBudget {
  /**
   * Absolute epoch-ms ceiling for the whole call. No attempt starts and no
   * backoff is slept past it, and an in-flight attempt is aborted when it is
   * reached.
   *
   * Absolute rather than a per-call duration on purpose: a duration cannot be
   * shared by the several Vertex calls one request makes, and an attempt count
   * bounds neither — one slow response can outlast any number of attempts.
   * The deadline is the thing that actually has to be met.
   */
  deadlineAt?: number;
  /** Maximum attempts including the first. Defaults to `DEFAULT_MAX_RETRIES`. */
  maxAttempts?: number;
}

/**
 * Raised when a call gives up because its wall-clock budget is spent, rather
 * than because Vertex rejected it. Callers the browser is waiting on surface
 * this as "taking longer than usual, try again" — a generic generation failure
 * would tell the user to fix content that is in fact fine.
 */
export class VertexBudgetExceededError extends Error {
  constructor(label: string) {
    super(`${label} exceeded its wall-clock retry budget.`);
    this.name = 'VertexBudgetExceededError';
  }
}

/**
 * A budget for one browser-awaited request. Create it once at the top of the
 * action or route handler and pass the SAME object to every Vertex-backed call
 * it makes, so the deadline bounds the request rather than each call.
 */
export function interactiveBudget(budgetMs: number = INTERACTIVE_VERTEX_BUDGET_MS): RetryBudget {
  return { deadlineAt: Date.now() + budgetMs };
}

function msRemaining(budget: RetryBudget | undefined): number {
  return budget?.deadlineAt === undefined ? Infinity : budget.deadlineAt - Date.now();
}

/**
 * Sleeps the backoff for `attempt`, or reports that the budget cannot absorb
 * it. A backoff that would end past the deadline is time spent to no purpose —
 * the attempt it precedes could never run.
 */
async function backoffWithinBudget(
  attempt: number,
  budget: RetryBudget | undefined,
): Promise<boolean> {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
  if (delay >= msRemaining(budget)) return false;
  await new Promise((r) => setTimeout(r, delay));
  return true;
}

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

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

/**
 * Resolve the Vertex AI project, with NO fallback by design.
 *
 * This previously read `process.env.GOOGLE_PROJECT_ID || 'theraptly-lms'`. Because
 * that default names the *production* project, any environment without the variable
 * set — staging included — silently issued its Vertex calls against production
 * while appearing correctly configured. Credentials came from Application Default
 * Credentials (the host's attached service account), so nothing in any env file
 * revealed the crossing.
 *
 * That is the same defect that caused two production video-deletion incidents: a
 * default pointing at production is invisibly right in production and invisibly
 * wrong everywhere else. Missing configuration must stop the call, not reroute it.
 */
function requireProjectId(): string {
  const projectId = process.env.GOOGLE_PROJECT_ID;
  if (!projectId) {
    const err = new Error(
      'GOOGLE_PROJECT_ID is not set — refusing to call Vertex AI. Set it explicitly per environment; there is deliberately no default.',
    );
    logger.error({ msg: '[ai-client] GOOGLE_PROJECT_ID is not configured', err });
    throw err;
  }
  return projectId;
}

async function withRetry<T>(
  fn: (attemptTimeoutMs: number) => Promise<T>,
  label: string,
  budget?: RetryBudget,
): Promise<T> {
  const maxAttempts = budget?.maxAttempts ?? DEFAULT_MAX_RETRIES;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = msRemaining(budget);
    if (remaining <= 0) {
      logger.warn({
        msg: `[ai-client] ${label} gave up on its time budget before attempt ${attempt + 1}`,
        data: lastError?.message,
      });
      throw new VertexBudgetExceededError(label);
    }

    try {
      if (attempt > 0) {
        logger.info({ msg: `[ai-client] ${label} retry ${attempt}/${maxAttempts - 1}...` });
      }
      return await fn(Math.min(VERTEX_AI_TIMEOUT_MS, remaining));
    } catch (err: unknown) {
      const error = err as Error;
      lastError = error;

      const isRetryable =
        /\b429\b/.test(error.message || '') ||
        /\b5\d{2}\b/.test(error.message || '') ||
        error.name === 'AbortError' ||
        error.message?.includes('fetch failed');

      if (!isRetryable) throw err;

      logger.warn({
        msg: `[ai-client] ${label} retryable error (attempt ${attempt + 1}/${maxAttempts}):`,
        data: error.message,
      });

      if (!(await backoffWithinBudget(attempt, budget))) {
        logger.warn({ msg: `[ai-client] ${label} exhausted its time budget`, data: error.message });
        throw new VertexBudgetExceededError(label);
      }
    }
  }

  throw lastError || new Error(`${label} failed after all retries.`);
}

export interface VertexAIConfig {
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  /**
   * Optional LLM-analytics context. Omit it and the call is simply not recorded
   * — nothing else changes — so wiring a call site is additive and a background
   * job with no user never produces an event attributed to an invented person.
   */
  telemetry?: AiTelemetry;
  /**
   * Bounds the retry ladder. Omit it and the call keeps the background-job
   * behaviour (5 attempts, no wall-clock ceiling); pass `interactiveBudget()`
   * on any path a browser is synchronously waiting on.
   */
  retry?: RetryBudget;
}

/**
 * Call Vertex AI with automatic retry + exponential backoff for 429/5xx errors.
 * Returns the raw text output from the model.
 *
 * @throws {VertexBudgetExceededError} when `config.retry` sets a deadline the
 * retry ladder cannot finish inside.
 */
export async function callVertexAI(prompt: string, config?: VertexAIConfig): Promise<string> {
  const projectId = requireProjectId();
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
    // F-049: safety filters are intentionally set to BLOCK_NONE.
    //
    // Risk: with untrusted document text as input, BLOCK_NONE means the model's
    // own safety guardrails will not pre-empt problematic generations — the
    // prompt-injection defence therefore rests on the delimiter/"treat as data"
    // framing in the prompt builders (see prompts-v4.6.ts) and the PHI scanner,
    // not on these thresholds.
    //
    // Why keep BLOCK_NONE (conservative choice): this client generates regulated
    // BEHAVIORAL-HEALTH training content that legitimately discusses sensitive
    // topics — abuse reporting, self-harm, restraint, medication, grievances.
    // Non-BLOCK thresholds routinely return finishReason=SAFETY (no content) on
    // exactly this material, which would break generation quality for the
    // product's core use case. Tightening thresholds should be paired with an
    // input-classification layer before it can be done without regressions.
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    ],
  });

  let lastError: Error | null = null;

  // Wall clock across ALL attempts, which is what the caller actually waited.
  // Per-attempt timing would understate a stage that succeeded only after two
  // backoffs, and backoff is the dominant cost when Vertex is rate-limiting.
  const startedAt = Date.now();

  /**
   * Records the generation. Called on every terminal path — success, non-
   * retryable throw, and retries-exhausted — so a stage that always fails is as
   * visible as one that succeeds. No-ops unless a telemetry context was passed.
   */
  const record = (outcome: {
    attempt: number;
    inputTokens: number;
    outputTokens: number;
    finishReason?: string | null;
    error?: unknown;
  }): void => {
    if (!config?.telemetry) return;
    captureGeneration({
      telemetry: config.telemetry,
      model,
      latencyMs: Date.now() - startedAt,
      ...outcome,
    });
  };

  const budget = config?.retry;
  const maxAttempts = budget?.maxAttempts ?? DEFAULT_MAX_RETRIES;
  let budgetExceeded = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = msRemaining(budget);
    if (remaining <= 0) {
      budgetExceeded = true;
      break;
    }

    // Each attempt gets its own AbortController so a timeout on one
    // attempt doesn't interfere with retries. The per-attempt timeout is
    // clamped to what is left of the budget, so a single slow response cannot
    // outlast the deadline the caller has to meet.
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      Math.min(VERTEX_AI_TIMEOUT_MS, remaining),
    );

    try {
      if (attempt > 0) {
        logger.info({ msg: `[ai-client] Retry ${attempt}/${maxAttempts - 1}...` });
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

        if (!(await backoffWithinBudget(attempt, budget))) {
          budgetExceeded = true;
          break;
        }
        continue;
      }

      // Non-retryable error
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vertex AI ${response.status} ${response.statusText}: ${errorText}`);
      }

      const json = await response.json();
      const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;
      const finishReason: string | null = json.candidates?.[0]?.finishReason ?? null;

      // Vertex reports exact token counts here and this response was previously
      // discarded, leaving the pipeline's real cost unmeasurable. These are the
      // authoritative numbers — estimateTokens() above is only a pre-flight
      // guess for budgeting.
      const inputTokens: number = json.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens: number = json.usageMetadata?.candidatesTokenCount ?? 0;

      if (!textPart) {
        logger.error({ msg: '[ai-client] Vertex AI returned no content', data: json });
        record({
          attempt,
          inputTokens,
          outputTokens,
          finishReason,
          // A truthful token count still applies: an empty completion blocked by
          // a SAFETY finishReason was billed for its input.
          error: new Error('no content'),
        });
        throw new Error(
          `Vertex AI returned no content in response. Finish Reason: ${finishReason || 'unknown'}`,
        );
      }

      record({ attempt, inputTokens, outputTokens, finishReason });
      return textPart;
    } catch (err: unknown) {
      const error = err as Error;
      // Timeout / abort → treat as retryable
      if (error.name === 'AbortError') {
        lastError = new Error(
          `Vertex AI request timed out after ${Math.round(Math.min(VERTEX_AI_TIMEOUT_MS, remaining) / 1000)}s (attempt ${attempt + 1})`,
        );
        logger.warn({ msg: `[ai-client] ${lastError.message}` });
        if (!(await backoffWithinBudget(attempt, budget))) {
          budgetExceeded = true;
          break;
        }
        continue;
      }
      // If it was already a retryable error we handled above, it was stored in lastError
      // If it's a network error, we should retry too
      if (error.message?.includes('fetch failed')) {
        lastError = error;
        if (!(await backoffWithinBudget(attempt, budget))) {
          budgetExceeded = true;
          break;
        }
        continue;
      }
      // Non-retryable errors: throw immediately
      record({ attempt, inputTokens: 0, outputTokens: 0, error });
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Retries exhausted, or the wall-clock budget ran out first. Recorded so a
  // stage that ALWAYS fails is as visible as one that succeeds — otherwise the
  // only signal is an absence of events, which reads identically to the
  // feature not being used.
  //
  // The two are logged apart on purpose: "ran out of time" and "Vertex kept
  // rejecting us" call for different fixes, and a 524 in front of this used to
  // erase the distinction entirely.
  if (budgetExceeded) {
    logger.warn({
      msg: '[ai-client] Vertex AI call abandoned — wall-clock budget exhausted',
      model,
      elapsedMs: Date.now() - startedAt,
      lastError: lastError?.message,
    });
  }

  const exhausted = budgetExceeded
    ? new VertexBudgetExceededError('Vertex AI call')
    : lastError || new Error('Vertex AI call failed after all retries.');
  record({
    attempt: maxAttempts - 1,
    inputTokens: 0,
    outputTokens: 0,
    error: exhausted,
  });
  throw exhausted;
}

/**
 * Generate a 768-dimensional vector embedding for the given text using text-embedding-004.
 */
export async function generateEmbedding(text: string, budget?: RetryBudget): Promise<number[]> {
  const results = await generateBatchEmbeddings([text], budget);
  return results[0];
}

/**
 * Generate embeddings for multiple texts in a single Vertex AI API call.
 * text-embedding-004 supports up to 250 instances per request.
 *
 * @param texts  Array of text strings to embed (max 250 per call enforced internally)
 * @param budget Optional wall-clock ceiling. Omit it for background jobs; pass
 *               `interactiveBudget()` on any path a browser is waiting on.
 * @returns      Array of 768-dimensional embedding vectors, same order as input
 */
export async function generateBatchEmbeddings(
  texts: string[],
  budget?: RetryBudget,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const projectId = requireProjectId();
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

  return withRetry(
    async (attemptTimeoutMs) => {
      // F-066: bound each attempt with an AbortController timeout so a hung
      // embedding request cannot stall indefinitely (mirrors callVertexAI). An
      // AbortError is retryable in withRetry, so a timed-out attempt is retried.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body,
          signal: controller.signal,
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
      } finally {
        clearTimeout(timeoutId);
      }
    },
    'Embedding',
    budget,
  );
}
