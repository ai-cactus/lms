import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

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
      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },
]);

export default eslintConfig;
