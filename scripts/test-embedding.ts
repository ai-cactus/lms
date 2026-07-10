/**
 * Test a single embedding call using the exact same path as the worker.
 *
 * Run (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/test-embedding.ts
 */
import { GoogleAuth } from 'google-auth-library';

interface EmbeddingResponse {
  predictions?: Array<{ embeddings?: { values?: number[] } }>;
}

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const projectId = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
const location = process.env.GOOGLE_LOCATION || 'us-central1';
const model = 'text-embedding-004';

console.log(`\nProject: ${projectId} | Location: ${location} | Model: ${model}`);

const text = 'This is a test sentence for embedding generation.';
const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

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
