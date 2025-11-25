/**
 * Fetch with automatic retry and exponential backoff
 * Handles network errors, 401 (auth issues), and 503 (service unavailable) gracefully
 */

export interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    retryOn?: number[]; // HTTP status codes to retry on
    onRetry?: (attempt: number, error: Error | Response) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 8000, // 8 seconds
    retryOn: [401, 408, 429, 500, 502, 503, 504], // Common transient errors
    onRetry: () => { },
};

/**
 * Sleep for a specified duration
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate delay with exponential backoff
 */
const calculateDelay = (attempt: number, baseDelay: number, maxDelay: number): number => {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay; // Add 0-30% jitter
    return Math.min(exponentialDelay + jitter, maxDelay);
};

/**
 * Determine if we should retry based on the error/response
 */
const shouldRetry = (error: Error | Response, retryOn: number[]): boolean => {
    // Network errors (fetch failures)
    if (error instanceof Error) {
        return true;
    }

    // HTTP errors
    if (error instanceof Response) {
        return retryOn.includes(error.status);
    }

    return false;
};

/**
 * Fetch with automatic retry logic
 */
export async function fetchWithRetry(
    url: string,
    init?: RequestInit,
    options?: RetryOptions
): Promise<Response> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | Response | null = null;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            const response = await fetch(url, init);

            // If successful, return immediately
            if (response.ok) {
                return response;
            }

            // If error but shouldn't retry, return the error response
            if (!shouldRetry(response, opts.retryOn)) {
                return response;
            }

            // Store the error response for potential retry
            lastError = response;

            // If we've exhausted retries, return the last error response
            if (attempt === opts.maxRetries) {
                return response;
            }

            // Calculate delay and retry
            const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
            opts.onRetry(attempt + 1, response);
            await sleep(delay);

        } catch (error) {
            // Network error or fetch failure
            lastError = error as Error;

            // If we've exhausted retries, throw the error
            if (attempt === opts.maxRetries) {
                throw error;
            }

            // Calculate delay and retry
            const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
            opts.onRetry(attempt + 1, error as Error);
            await sleep(delay);
        }
    }

    // This should never be reached, but TypeScript needs it
    if (lastError instanceof Response) {
        return lastError;
    }
    throw lastError || new Error('Fetch failed after retries');
}

/**
 * Wrapper for JSON API calls with retry
 */
export async function fetchJsonWithRetry<T = any>(
    url: string,
    init?: RequestInit,
    options?: RetryOptions
): Promise<T> {
    const response = await fetchWithRetry(url, init, options);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
}
