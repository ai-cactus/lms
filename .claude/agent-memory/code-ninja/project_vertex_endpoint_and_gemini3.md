---
name: project-vertex-endpoint-and-gemini3
description: BUG-19 (2026-09-22) moved generation to the US multi-region endpoint + gemini-3.1-flash-lite; embeddings stay regional; Gemini 3 request traps and a live-smoke recipe
metadata:
  type: project
---

Generation: `VERTEX_LOCATION` (default `us`) / `VERTEX_MODEL` (default `gemini-3.1-flash-lite`), resolved in `src/lib/ai/vertex-config.ts`. Embeddings: `text-embedding-004` on regional `GOOGLE_LOCATION` only (404 on `us`/`eu`; changing the model would orphan stored vectors).

**Why:** regional us-central1 Standard-PayGo 429s are contention, not quota; the PHI scan starved its 45 s budget. gemini-2.5-flash-lite is NOT served on `us` (404).

**How to apply (Gemini 3 traps):**
- `thinkingConfig.thinkingLevel` errors on pre-3 models and the allowed levels differ per 3.x model, so it is sent only for models in the per-model map.
- Google recommends dropping explicit temperature for Gemini 3 (looping risk); from 3.6 it is ignored. The client omits it for major >= 3.
- Responses can split answer text across several parts and carry `thought`/`thoughtSignature` parts; never read `parts[0]` alone (seen live: a 2-part PHI-scan response).
- Never log a response body or model text (a PHI-scan answer quotes PHI): use `describeVertexResponse()` / `responseChars`. Thinking tokens are billed as output ("Text output (response and reasoning)") so `outputTokens` = candidates + thoughts.
- VM egress to `aiplatform.us.rep.googleapis.com` verified from the staging container (VM SA, 200) on 2026-09-22. Non-global Vertex pricing is ~10% above global.
- Live smoke from this box: `gcloud auth print-access-token` works (no ADC file); patch `GoogleAuth.prototype.getAccessToken`, run with `node --conditions=react-server --import tsx <script>` (server-only guard), and extract PDF text with plain `node` (pdf-parse throws "bad XRef entry" under tsx).
