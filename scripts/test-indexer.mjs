#!/usr/bin/env node
/**
 * Directly test the indexStandardManual pipeline against the active manual.
 * Run with:  node --require tsconfig-paths/register scripts/test-indexer.mjs
 * Or simply: npx tsx scripts/test-indexer.mjs
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// Load .env
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
} catch {
  console.warn('⚠ Could not load .env');
}

const Minio = require('minio');
const pdfParse = require('pdf-parse');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const client = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT  ?? 'localhost',
  port:      parseInt(process.env.MINIO_PORT ?? '9005', 10),
  useSSL:    process.env.MINIO_USE_SSL  === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev',
});

async function downloadBuffer(storagePath) {
  const match = storagePath.match(/^minio:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Cannot parse: ${storagePath}`);
  const [, bucket, key] = match;
  const stream = await client.getObject(bucket, key);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function run() {
  // 1. Get active manual
  const manual = await prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!manual) { console.error('No active manual in DB'); return; }
  console.log(`\nTesting against: ${manual.filename} (${manual.id})`);
  console.log(`storagePath: ${manual.storagePath}`);

  // 2. Download PDF
  console.log('\n─── Downloading PDF...');
  const buf = await downloadBuffer(manual.storagePath);
  console.log(`✓ Downloaded ${buf.length} bytes`);

  // 3. Test pdf-parse
  console.log('\n─── Parsing PDF with pdf-parse...');
  let pdfData;
  try {
    pdfData = await pdfParse(buf);
    console.log(`✓ Extracted ${pdfData.text?.length ?? 0} characters`);
    console.log(`  Pages: ${pdfData.numpages}`);
    console.log(`  First 200 chars: ${JSON.stringify(pdfData.text?.slice(0, 200))}`);
  } catch (err) {
    console.error(`✗ pdf-parse FAILED: [${err.name}] ${err.message}`);
    console.error(err.stack);
    return;
  }

  // 4. Test generateEmbedding with one small chunk
  console.log('\n─── Testing embedding API...');
  const GOOGLE_VERTEX_PROJECT = process.env.GOOGLE_PROJECT_ID || process.env.GCP_PROJECT_ID;
  const GOOGLE_VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
  const VERTEX_EMBEDDING_MODEL = process.env.VERTEX_EMBEDDING_MODEL || 'text-embedding-004';
  const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

  console.log(`  GOOGLE_AI_API_KEY: ${GOOGLE_AI_API_KEY ? GOOGLE_AI_API_KEY.slice(0,6)+'****' : 'NOT SET'}`);
  console.log(`  GOOGLE_PROJECT_ID: ${GOOGLE_VERTEX_PROJECT ?? 'NOT SET'}`);

  const testChunk = (pdfData.text || '').slice(0, 300).trim();
  if (!testChunk) { console.log('  ⚠ No text to embed'); return; }

  // Try Gemini REST API (what ai-client.ts likely uses)
  if (GOOGLE_AI_API_KEY) {
    const model = 'text-embedding-004';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GOOGLE_AI_API_KEY}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: testChunk }] } }),
      });
      const body = await res.json();
      if (!res.ok) {
        console.error(`  ✗ Embedding API error ${res.status}:`, JSON.stringify(body));
      } else {
        const dim = body.embedding?.values?.length ?? 0;
        console.log(`  ✓ Embedding OK — ${dim} dimensions`);
      }
    } catch (err) {
      console.error(`  ✗ Fetch failed: ${err.message}`);
    }
  } else {
    console.log('  ⚠ No GOOGLE_AI_API_KEY — skipping embedding test');
  }

  await prisma.$disconnect();
  console.log('\n─── Test complete ──────────────────────────────────\n');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
