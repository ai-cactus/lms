import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

/**
 * Shared no-restricted-syntax selectors.
 *
 * Hoisted because the test-file override below needs to keep the PHI-egress bans
 * while dropping only the bcrypt one. Switching `no-restricted-syntax` off
 * wholesale for tests would silently un-ban the non-BAA Gemini host there too.
 */
const GEMINI_HOST_SELECTORS = [
  {
    // Plain string literal: 'https://generativelanguage.googleapis.com/...'
    selector: 'Literal[value=/generativelanguage\\.googleapis\\.com/]',
    message:
      'generativelanguage.googleapis.com is the non-BAA consumer Gemini host. Route AI calls through @/lib/ai-client (Vertex AI, BAA-covered).',
  },
  {
    // Template literal: `https://generativelanguage.googleapis.com/${...}`
    selector: 'TemplateElement[value.raw=/generativelanguage\\.googleapis\\.com/]',
    message:
      'generativelanguage.googleapis.com is the non-BAA consumer Gemini host. Route AI calls through @/lib/ai-client (Vertex AI, BAA-covered).',
  },
];

/**
 * F-058: a hardcoded work factor silently opts out of the shared constant.
 * `bcrypt.hash(pw, 12)` is identical to BCRYPT_COST today, so the bug only
 * appears the day someone raises the constant and one call site quietly keeps
 * minting weaker hashes. A centralisation that one site ignores is not a
 * centralisation. (Found exactly that: scripts/create-admin.ts was hashing real
 * admin passwords at cost 10.)
 */
const BCRYPT_COST_SELECTOR = {
  selector:
    'CallExpression[callee.object.name="bcrypt"][callee.property.name="hash"][arguments.1.type="Literal"]',
  message:
    'Do not hardcode the bcrypt work factor. Import BCRYPT_COST from @/lib/bcrypt-config so raising it upgrades every hash site at once.',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Disable ESLint rules that conflict with Prettier formatting.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  // ── PHI egress guard (F-003) ───────────────────────────────────────────────
  // PHI may only reach Google through the BAA-covered Vertex AI endpoint that
  // src/lib/ai-client.ts uses (OAuth service account, *-aiplatform.googleapis.com).
  // The consumer Gemini surface — the @google/generative-ai SDK and the
  // generativelanguage.googleapis.com REST host — is NOT BAA-covered, so any
  // document text sent there is an uncontrolled disclosure.
  //
  // This was previously a convention documented in the findings register. It is
  // now a build failure, because a convention cannot survive a new contributor
  // reaching for the first SDK that autocompletes.
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@google/generative-ai',
              message:
                'The consumer Gemini SDK is not BAA-covered. Use callVertexAI/generateBatchEmbeddings from @/lib/ai-client, which targets the BAA-covered Vertex AI endpoint.',
            },
            {
              name: '@google/genai',
              message:
                'Do not call Google GenAI SDKs directly — the same SDK can target the non-BAA consumer endpoint. Use callVertexAI/generateBatchEmbeddings from @/lib/ai-client.',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...GEMINI_HOST_SELECTORS, BCRYPT_COST_SELECTOR],
    },
  },
  // Tests legitimately hash at a LOW cost on purpose: a real bcrypt hash is
  // sometimes needed (to exercise unmocked verification) but cost 12 makes the
  // suite crawl, so e.g. mfa.test.ts uses 4 deliberately. Forcing BCRYPT_COST
  // there would trade real seconds per run for no security whatsoever — nothing
  // in a test fixture protects anything.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts'],
    rules: {
      // Gemini bans stay; only the bcrypt-cost selector is dropped.
      'no-restricted-syntax': ['error', ...GEMINI_HOST_SELECTORS],
    },
  },
]);

export default eslintConfig;
