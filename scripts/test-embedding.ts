/**
 * Test a single embedding call using the exact same path as the worker.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/test-embedding.ts
 */
import { GoogleAuth } from 'google-auth-library';
import {
  buildVertexModelUrl,
  resolveVertexEmbeddingLocation,
  VERTEX_EMBEDDING_MODEL,
} from '@/lib/ai/vertex-config';
import { logger } from '@/lib/logger';

interface EmbeddingResponse {
  predictions?: Array<{ embeddings?: { values?: number[] } }>;
}

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const projectId = process.env.GOOGLE_PROJECT_ID;
if (!projectId) {
  logger.error({
    msg: '[test-embedding] GOOGLE_PROJECT_ID is not set — refusing to call Vertex AI (no production fallback).',
  });
  process.exit(1);
}
const location = resolveVertexEmbeddingLocation();
const model = VERTEX_EMBEDDING_MODEL;

logger.info({
  msg: `[test-embedding] Project: ${projectId} | Location: ${location} | Model: ${model}`,
});

const text = 'This is a test sentence for embedding generation.';
const url = buildVertexModelUrl({ projectId, location, model, method: 'predict' });

const body = JSON.stringify({
  instances: [{ task_type: 'RETRIEVAL_DOCUMENT', title: '', content: text }],
});

try {
  const token = await auth.getAccessToken();
  logger.info({ msg: `[test-embedding] Token: ✓ (${token?.slice(0, 12)}...)` });

  logger.info({ msg: `[test-embedding] POST ${url}` });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  });

  const json = (await res.json()) as EmbeddingResponse;
  if (!res.ok) {
    logger.error({
      msg: `[test-embedding] ✗ HTTP ${res.status}`,
      response: json,
    });
  } else {
    const values = json.predictions?.[0]?.embeddings?.values;
    logger.info({ msg: `[test-embedding] ✓ Embedding OK — ${values?.length ?? 0} dimensions` });
  }
} catch (err) {
  logger.error({ msg: '[test-embedding] ✗ Embedding call failed', err });
}
