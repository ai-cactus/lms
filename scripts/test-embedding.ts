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

interface EmbeddingResponse {
  predictions?: Array<{ embeddings?: { values?: number[] } }>;
}

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const projectId = process.env.GOOGLE_PROJECT_ID;
if (!projectId) {
  console.error(
    'GOOGLE_PROJECT_ID is not set — refusing to call Vertex AI (no production fallback).',
  );
  process.exit(1);
}
const location = resolveVertexEmbeddingLocation();
const model = VERTEX_EMBEDDING_MODEL;

console.log(`\nProject: ${projectId} | Location: ${location} | Model: ${model}`);

const text = 'This is a test sentence for embedding generation.';
const url = buildVertexModelUrl({ projectId, location, model, method: 'predict' });

const body = JSON.stringify({
  instances: [{ task_type: 'RETRIEVAL_DOCUMENT', title: '', content: text }],
});

try {
  const token = await auth.getAccessToken();
  console.log(`Token: ✓ (${token?.slice(0, 12)}...)`);

  console.log(`\nPOST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  });

  const json = (await res.json()) as EmbeddingResponse;
  if (!res.ok) {
    console.error(`\n✗ HTTP ${res.status}:`, JSON.stringify(json, null, 2));
  } else {
    const values = json.predictions?.[0]?.embeddings?.values;
    console.log(`\n✓ Embedding OK — ${values?.length ?? 0} dimensions`);
  }
} catch (err) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`\n✗ ${e.name}: ${e.message}`);
  console.error(e.stack);
}
