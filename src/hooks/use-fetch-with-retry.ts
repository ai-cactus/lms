"use client";

import { useCallback } from 'react';
import { fetchWithRetry, fetchJsonWithRetry, RetryOptions } from '@/lib/fetch-with-retry';
import { useNetwork } from '@/contexts/network-context';

/**
 * Hook that provides fetch with retry capabilities and integrates with network status
 */
export function useFetchWithRetry() {
    const { startRetry, endRetry, incrementRetry } = useNetwork();

    const fetch = useCallback(
        async (url: string, init?: RequestInit, options?: RetryOptions) => {
            try {
                const response = await fetchWithRetry(url, init, {
                    ...options,
                    onRetry: (attempt, error) => {
                        if (attempt === 1) {
                            startRetry();
                        }
                        incrementRetry();
                        options?.onRetry?.(attempt, error);
                    },
                });

                endRetry();
                return response;
            } catch (error) {
                endRetry();
                throw error;
            }
        },
        [startRetry, endRetry, incrementRetry]
    );

    const fetchJson = useCallback(
        async <T = any>(url: string, init?: RequestInit, options?: RetryOptions): Promise<T> => {
            try {
                const data = await fetchJsonWithRetry<T>(url, init, {
                    ...options,
                    onRetry: (attempt, error) => {
                        if (attempt === 1) {
                            startRetry();
                        }
                        incrementRetry();
                        options?.onRetry?.(attempt, error);
                    },
                });

                endRetry();
                return data;
            } catch (error) {
                endRetry();
                throw error;
            }
        },
        [startRetry, endRetry, incrementRetry]
    );

    return { fetch, fetchJson };
}
