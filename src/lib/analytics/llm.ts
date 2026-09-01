import 'server-only';

/**
 * LLM analytics for the Vertex AI calls.
 *
 * Every Gemini call in this app funnels through callVertexAI() in
 * src/lib/ai-client.ts — the five v4.6 pipeline stages, the PHI scanner, quiz
 * grading and the legacy course/quiz actions all use it. Instrumenting that one
 * function is therefore enough to see cost, latency, token usage and failure
 * rate per stage and per customer organization, which nothing currently
 * measures.
 *
 * ⛔ THE PROMPT NEVER LEAVES THIS PROCESS.
 *
 * PostHog's schema has `$ai_input` and `$ai_output_choices` for the prompt and
 * completion, and its own SDKs populate them by default. On this app the prompt
 * is assembled from a facility's uploaded source documents, so those fields
 * would carry exactly the clinical material the no-BAA posture exists to keep
 * out. They are not declared on the `$ai_generation` event type, so sending one
 * does not compile — see events.ts.
 *
 * Cost is deliberately NOT computed here. PostHog derives it from
 * `$ai_model` + the token counts, so a price change is a PostHog-side update
 * rather than a deploy, and there is no local price table to drift.
 */
import { captureServer } from '@/lib/analytics/server';
import { getAiContext } from '@/lib/analytics/ai-context';
import type { AnalyticsEventProperties } from '@/lib/analytics/events';

/** Pipeline stage labels. A closed vocabulary so the property stays groupable. */
export type AiStage =
  | 'article'
  | 'slides'
  | 'quiz'
  | 'judge'
  | 'regen'
  | 'phi_scan'
  | 'quiz_grade'
  | 'legacy_course'
  | 'legacy_quiz'
  | 'embedding';

type ErrorReason = AnalyticsEventProperties['$ai_generation']['$ai_error_type'];

/**
 * Per-call telemetry passed through VertexAIConfig.
 *
 * Only the STAGE, because that is the one thing a leaf call knows about itself.
 * Identity and trace id come from the ambient run context (ai-context.ts) that
 * the pipeline orchestrator binds once — see that module for why.
 */
export interface AiTelemetry {
  stage: AiStage;
}

/**
 * Classifies a Vertex failure into a fixed vocabulary.
 *
 * The raw message is never sent: a Vertex error body echoes the request, which
 * on this app means source-document text. Matching on shape here keeps the
 * signal (why generations fail) without the payload.
 */
export function classifyAiError(err: unknown): ErrorReason {
  const message = err instanceof Error ? err.message : String(err ?? '');

  if (/timed out|AbortError/i.test(message)) return 'timeout';
  if (/\b429\b|rate limit|quota/i.test(message)) return 'rate_limit';
  if (/\b5\d{2}\b|fetch failed/i.test(message)) return 'server_error';
  if (/no content/i.test(message)) return 'no_content';
  return 'unknown';
}

/**
 * Records one LLM generation.
 *
 * Never throws — captureServer swallows its own failures, and the property
 * object is built from scalars already in hand rather than derived, so there is
 * nothing here that can fail into the AI pipeline's path.
 */
export function captureGeneration(params: {
  telemetry: AiTelemetry;
  model: string;
  /** Wall-clock for the call INCLUDING retries, in milliseconds. */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  attempt: number;
  finishReason?: string | null;
  error?: unknown;
}): void {
  // No run context means no identifiable user — a script, a sweep, or a call
  // site not yet wired. Recording it would either need an invented distinctId
  // (which inflates every unique-user count) or produce an orphan trace.
  const run = getAiContext();
  if (!run?.distinctId) return;

  const isError = params.error !== undefined && params.error !== null;

  captureServer(
    '$ai_generation',
    {
      $ai_trace_id: run.traceId,
      $ai_span_name: params.telemetry.stage,
      $ai_model: params.model,
      $ai_provider: 'google',
      $ai_input_tokens: params.inputTokens,
      $ai_output_tokens: params.outputTokens,
      // PostHog's schema expresses latency in SECONDS; call sites measure in
      // milliseconds because that is what Date.now() gives.
      $ai_latency: params.latencyMs / 1000,
      $ai_is_error: isError,
      $ai_stop_reason: params.finishReason ?? null,
      $ai_error_type: isError ? classifyAiError(params.error) : null,
      attempt: params.attempt,
    },
    {
      distinctId: run.distinctId,
      organizationId: run.organizationId,
    },
  );
}
