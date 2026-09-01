import 'server-only';

/**
 * Per-generation AI telemetry context, propagated via AsyncLocalStorage.
 *
 * Mirrors src/lib/request-context.ts (F-067), for the same reason: the v4.6
 * pipeline is five stage functions with five different positional signatures,
 * plus an internal chunk helper. Threading a telemetry argument through all of
 * them — and every call site — to reach one leaf function (callVertexAI) would
 * touch far more code than the feature is worth, and every future stage would
 * have to remember to forward it.
 *
 * Instead the ORCHESTRATOR binds the run context once, and each stage declares
 * only its own name at the point it calls Vertex.
 *
 * Outside a runWithAiContext() scope getAiContext() returns undefined, and
 * captureGeneration() then records nothing — which is the correct behaviour for
 * a call with no identifiable user, such as a sweep or a script.
 *
 * Node-only (node:async_hooks). Never import from a client component or the
 * Edge proxy.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface AiRunContext {
  /**
   * Shared by every Vertex call in one course generation, so PostHog renders
   * stages A-E as a single trace. The Job id is a natural fit — already unique
   * per generation and already logged, so a trace can be tied back to a job.
   */
  traceId: string;
  /** The user who triggered the run. Without it nothing is recorded. */
  distinctId: string;
  organizationId?: string | null;
}

const storage = new AsyncLocalStorage<AiRunContext>();

/**
 * Binds the run context for the duration of `fn`, including everything it
 * awaits. Wrap the whole pipeline, not individual stages.
 */
export function runWithAiContext<T>(context: AiRunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getAiContext(): AiRunContext | undefined {
  return storage.getStore();
}
