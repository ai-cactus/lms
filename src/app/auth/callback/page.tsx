'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Hexagon } from "@phosphor-icons/react";

function CallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const supabase = createClient();
        const next = searchParams.get('next') || '/worker/dashboard';
        const code = searchParams.get('code');

        // Helper to handle successful auth
        const handleSuccess = () => {
            router.refresh();
            router.push(next);
        };

        // 1. Handle PKCE flow (Code in URL)
        if (code) {
            const exchangeCode = async () => {
                const { error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) {
                    console.error('Error exchanging code:', error);
                    setError(error.message);
                } else {
                    handleSuccess();
                }
            };
            exchangeCode();
            return;
        }

        // 2. Handle Implicit Flow (Hash in URL) - Automatic Detection
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                handleSuccess();
            }
        });

        // 3. Fallback: Manual Hash Parsing & Session Check
        const checkSession = async () => {
            // First, check if Supabase already found it
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();

            if (session) {
                handleSuccess();
                return;
            }

            // If not, try to parse the hash manually
            if (typeof window !== 'undefined' && window.location.hash) {
                const hash = window.location.hash.substring(1); // Remove #
                const params = new URLSearchParams(hash);
                const accessToken = params.get('access_token');
                const refreshToken = params.get('refresh_token');

                if (accessToken && refreshToken) {
                    const { error: setSessionError } = await supabase.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken,
                    });

                    if (!setSessionError) {
                        handleSuccess();
                        return;
                    } else {
                        console.error("Manual setSession failed:", setSessionError);
                    }
                }
            }

            // If we are still here after a delay, then we truly failed
            setTimeout(async () => {
                const { data: { session: finalSession } } = await supabase.auth.getSession();
                if (!finalSession) {
                    setError('Authentication failed. No session found.');
                }
            }, 4000);
        };

        checkSession();

        return () => {
            subscription.unsubscribe();
        };
    }, [router, searchParams]);

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center max-w-md w-full">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Authentication Error</h1>
                    <p className="text-slate-600 mb-6">{error}</p>

                    {/* Debug Info */}
                    <div className="mb-6 p-4 bg-slate-100 rounded text-left text-xs font-mono overflow-auto max-h-32">
                        <p><strong>Debug Info:</strong></p>
                        <p>Params: {searchParams.toString()}</p>
                        <p>Hash: {typeof window !== 'undefined' ? window.location.hash : 'N/A'}</p>
                    </div>

                    <button
                        onClick={() => router.push('/login')}
                        className="block w-full py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                    >
                        Back to Login
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-4">
                    <Hexagon size={48} weight="fill" className="text-indigo-600 animate-pulse" />
                </div>
                <h2 className="text-xl font-semibold text-slate-900">Verifying...</h2>
                <p className="text-slate-500">Please wait while we log you in.</p>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <CallbackContent />
        </Suspense>
    );
}
