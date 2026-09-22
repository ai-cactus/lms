/**
 * Vertex AI endpoint and model configuration.
 *
 * Generation and embeddings are configured SEPARATELY, on purpose:
 *
 * - generateContent (every Gemini call) targets `VERTEX_LOCATION` /
 *   `VERTEX_MODEL`, defaulting to the US multi-region endpoint. On Standard
 *   PayGo a regional 429 means "temporary high contention for a specific shared
 *   resource", not a quota that can be raised, and the regional `us-central1`
 *   pool starved the interactive PHI scan (BUG-19). The multi-region endpoint
 *   draws on a larger pool while Google documents that "machine learning
 *   processing of Customer Data by the service stays within" the United States.
 * - Embeddings (`text-embedding-004` `:predict`) stay on the REGIONAL
 *   `GOOGLE_LOCATION`. The model is not served on the `us`/`eu` multi-region
 *   endpoints (verified 404), and switching the embedding model would make new
 *   vectors incomparable with every vector already stored.
 *
 * Pure and dependency-free so it can be imported by Server Actions, route
 * handlers and the standalone `scripts/` workers alike.
 */

export const DEFAULT_VERTEX_GENERATION_LOCATION = 'us';
export const DEFAULT_VERTEX_GENERATION_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_VERTEX_EMBEDDING_LOCATION = 'us-central1';
export const VERTEX_EMBEDDING_MODEL = 'text-embedding-004';

export type VertexLocationKind = 'regional' | 'global' | 'multi-region';

export type VertexThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

/** `process.env`, or a plain object standing in for it in tests. */
export type VertexEnv = Readonly<Record<string, string | undefined>>;

export interface VertexGenerationTarget {
  location: string;
  model: string;
}

export class VertexConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VertexConfigError';
  }
}

// The documented multi-region hostnames are aiplatform.us.rep.googleapis.com and
// aiplatform.eu.rep.googleapis.com; no other multi-region exists.
const MULTI_REGIONS: ReadonlySet<string> = new Set(['us', 'eu']);

// Google Cloud region ids: `us-central1`, `europe-west4`, `northamerica-northeast1`.
const REGION_PATTERN = /^[a-z]+-[a-z]+[0-9]+$/;

// Interpolated into the request path, so anything beyond a plain model id
// (slashes, `:`, `?`, whitespace) is rejected rather than escaped.
const MODEL_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * The lowest `thinkingLevel` Google documents for each Gemini 3+ model this app
 * has been verified against. Latency is the constraint that matters here: the
 * PHI scan runs its chunks sequentially inside a 45 s interactive budget.
 *
 * A model absent from this map gets no `thinkingConfig` at all and runs at its
 * own default. That is deliberate: `thinkingLevel` is rejected with an error by
 * pre-Gemini-3 models, and the supported levels differ per Gemini 3 model (some
 * start at LOW), so guessing a level for an unlisted model could turn every call
 * into a 400. Add a model here only after checking the thinking-level table in
 * the Vertex "Thinking" documentation.
 */
const LOWEST_THINKING_LEVEL: Readonly<Record<string, VertexThinkingLevel>> = {
  'gemini-3.1-flash-lite': 'MINIMAL',
  'gemini-3.5-flash-lite': 'MINIMAL',
};

/**
 * Classifies a Vertex location. Throws `VertexConfigError` for anything that is
 * not `global`, a documented multi-region, or a well-formed region id.
 */
export function vertexLocationKind(location: string): VertexLocationKind {
  if (location === 'global') return 'global';
  if (MULTI_REGIONS.has(location)) return 'multi-region';
  if (REGION_PATTERN.test(location)) return 'regional';
  throw new VertexConfigError(
    `Unsupported Vertex AI location "${location}". Use a region (e.g. us-central1), "global", or a multi-region ("us" or "eu").`,
  );
}

/** The API host for a location — each location type has a different host shape. */
export function vertexApiHost(location: string): string {
  switch (vertexLocationKind(location)) {
    case 'global':
      return 'aiplatform.googleapis.com';
    case 'multi-region':
      return `aiplatform.${location}.rep.googleapis.com`;
    case 'regional':
      return `${location}-aiplatform.googleapis.com`;
  }
}

export function assertVertexModelId(model: string): string {
  if (!MODEL_PATTERN.test(model)) {
    throw new VertexConfigError(
      `Invalid Vertex AI model id "${model}". Expected a publisher model id such as ${DEFAULT_VERTEX_GENERATION_MODEL}.`,
    );
  }
  return model;
}

export function buildVertexModelUrl(params: {
  projectId: string;
  location: string;
  model: string;
  method: 'generateContent' | 'predict';
}): string {
  const { projectId, location, model, method } = params;
  const host = vertexApiHost(location);
  assertVertexModelId(model);
  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${location}/publishers/google/models/${model}:${method}`;
}

function readTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Where generateContent calls go. `VERTEX_LOCATION` / `VERTEX_MODEL` override
 * the defaults per environment; malformed values throw instead of silently
 * falling back, so a typo surfaces at boot (see src/lib/env.ts) rather than as
 * a stream of 404s.
 */
export function resolveVertexGenerationTarget(
  env: VertexEnv = process.env,
): VertexGenerationTarget {
  const location = readTrimmed(env.VERTEX_LOCATION) ?? DEFAULT_VERTEX_GENERATION_LOCATION;
  const model = readTrimmed(env.VERTEX_MODEL) ?? DEFAULT_VERTEX_GENERATION_MODEL;
  vertexLocationKind(location);
  assertVertexModelId(model);
  return { location, model };
}

/**
 * Where embedding calls go: always a single region, from `GOOGLE_LOCATION`.
 * `text-embedding-004` is not served on the multi-region endpoints, so a
 * non-regional value is a configuration error, not something to route around.
 */
export function resolveVertexEmbeddingLocation(env: VertexEnv = process.env): string {
  const location = readTrimmed(env.GOOGLE_LOCATION) ?? DEFAULT_VERTEX_EMBEDDING_LOCATION;
  if (vertexLocationKind(location) !== 'regional') {
    throw new VertexConfigError(
      `GOOGLE_LOCATION must be a single region (e.g. ${DEFAULT_VERTEX_EMBEDDING_LOCATION}) because ${VERTEX_EMBEDDING_MODEL} embeddings are served regionally; got "${location}". Use VERTEX_LOCATION to move generation instead.`,
    );
  }
  return location;
}

/** See `LOWEST_THINKING_LEVEL`: undefined means "send no thinkingConfig". */
export function vertexThinkingLevelFor(model: string): VertexThinkingLevel | undefined {
  return LOWEST_THINKING_LEVEL[model];
}

/**
 * Whether a caller-chosen `temperature` should be sent for this model.
 *
 * Not for Gemini 3 and later. Google: "For Gemini 3, it is strongly recommended
 * to keep the temperature parameter at its default value of 1.0 … Changing the
 * temperature (setting it to less than 1.0) may lead to unexpected behavior,
 * such as looping or degraded performance", and from Gemini 3.6 Flash custom
 * values "aren't supported and are ignored if set". Earlier models keep the
 * per-call temperatures their prompts were tuned with.
 */
export function vertexAcceptsCustomTemperature(model: string): boolean {
  const major = /^gemini-(\d+)(?:[.-]|$)/.exec(model)?.[1];
  return major === undefined || Number(major) < 3;
}
