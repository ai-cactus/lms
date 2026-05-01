#!/usr/bin/env node
/**
 * Test a single embedding call using the exact same path as the worker.
 * Run: node scripts/test-embedding.mjs
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const require = createRequire(import.meta.url);

try {
  const lines = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('✓ .env loaded');
} catch { console.warn('⚠ No .env'); }

const { GoogleAuth } = require('google-auth-library');

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const projectId = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
const location  = process.env.GOOGLE_LOCATION   || 'us-central1';
const model     = 'text-embedding-004';

console.log(`\nProject: ${projectId} | Location: ${location} | Model: ${model}`);

const text = 'This is a test sentence for embedding generation.';
const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

const body = JSON.stringify({
  instances: [{ task_type: 'RETRIEVAL_DOCUMENT', title: '', content: text }],
});

try {
  const token = await auth.getAccessToken();
  console.log(`Token: ✓ (${token?.slice(0,12)}...)`);

  console.log(`\nPOST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  });

  const json = await res.json();
  if (!res.ok) {
    console.error(`\n✗ HTTP ${res.status}:`, JSON.stringify(json, null, 2));
  } else {
    const values = json.predictions?.[0]?.embeddings?.values;
    console.log(`\n✓ Embedding OK — ${values?.length ?? 0} dimensions`);
  }
} catch (err) {
  console.error(`\n✗ ${err.name}: ${err.message}`);
  console.error(err.stack);
}
