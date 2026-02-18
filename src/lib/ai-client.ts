// ──────────────────────────────────────────────
// Centralized Vertex AI Client
// Handles retries with exponential backoff,
// token estimation, and context truncation.
// ──────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

// ── Token utilities ──────────────────────────

/** Rough token estimate: ~4 characters per token for English text. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a target token budget.
 * Cuts at a sentence boundary when possible to preserve readability.
 */
export function truncateToContext(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;

    // Try to cut at the last sentence ending before the limit
    const truncated = text.substring(0, maxChars);
    const lastSentenceEnd = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('.\n'),
        truncated.lastIndexOf('? '),
        truncated.lastIndexOf('! ')
    );

    const cutPoint = lastSentenceEnd > maxChars * 0.8 ? lastSentenceEnd + 1 : maxChars;
    return text.substring(0, cutPoint) + '\n...[truncated]';
}

// ── Core API caller ──────────────────────────

export interface VertexAIConfig {
    temperature?: number;
    maxOutputTokens?: number;
    model?: string;
}

/**
 * Call Vertex AI with automatic retry + exponential backoff for 429/5xx errors.
 * Returns the raw text output from the model.
 */
export async function callVertexAI(
    prompt: string,
    config?: VertexAIConfig
): Promise<string> {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('Missing Gemini API Key. Set NEXT_PUBLIC_GEMINI_API_KEY or GEMINI_API_KEY.');
    }

    const projectId = process.env.GOOGLE_PROJECT_ID || 'theraptly-lms';
    const location = process.env.GOOGLE_LOCATION || 'us-central1';
    const model = config?.model || 'gemini-2.5-flash-lite';

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent?key=${apiKey}`;

    const body = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: config?.temperature ?? 0.7,
            maxOutputTokens: config?.maxOutputTokens ?? 8192,
        },
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < DEFAULT_MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                console.log(`[ai-client] Retry ${attempt}/${DEFAULT_MAX_RETRIES - 1}...`);
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });

            // Retryable status codes: 429 (rate limit) and 5xx (server errors)
            if (response.status === 429 || response.status >= 500) {
                const errorText = await response.text();
                lastError = new Error(
                    `Vertex AI ${response.status} ${response.statusText}: ${errorText}`
                );
                console.warn(`[ai-client] Retryable error (${response.status}):`, lastError.message);

                // Exponential backoff with jitter
                const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            // Non-retryable error
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Vertex AI ${response.status} ${response.statusText}: ${errorText}`
                );
            }

            const json = await response.json();
            const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!textPart) {
                throw new Error('Vertex AI returned no content in response.');
            }

            return textPart;
        } catch (err: any) {
            // If it was already a retryable error we handled above, it was stored in lastError
            // If it's a network error, we should retry too
            if (err.message?.includes('fetch failed') || err.code === 'ECONNRESET') {
                lastError = err;
                const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            // Non-retryable errors: throw immediately
            throw err;
        }
    }

    throw lastError || new Error('Vertex AI call failed after all retries.');
}
