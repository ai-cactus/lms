"use client";

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Theraptly Logo Component
function TheraptlyLogo({ className = "" }: { className?: string }) {
    return (
        <div className={`flex items-center gap-3 ${className}`}>
            <div className="text-blue-600">
                <svg width="33" height="33" viewBox="0 0 33 33" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g clipPath="url(#clip0_11899_3653)">
                        <path fillRule="evenodd" clipRule="evenodd" d="M11.0669 0.406494C9.24613 0.406494 7.49998 1.11215 6.21251 2.36822L0 8.42917V11.2035C0 13.1635 0.862979 14.9269 2.23847 16.1517C0.862979 17.3766 0 19.14 0 21.1V23.8743L6.21251 29.9353C7.49998 31.1914 9.24613 31.897 11.0669 31.897C13.076 31.897 14.8834 31.0551 16.1389 29.7131C17.3943 31.0551 19.2018 31.897 21.2109 31.897C23.0317 31.897 24.7778 31.1914 26.0653 29.9353L32.2778 23.8743V21.1C32.2778 19.14 31.4148 17.3766 30.0393 16.1517C31.4148 14.9269 32.2778 13.1635 32.2778 11.2035V8.42917L26.0653 2.36822C24.7778 1.11215 23.0317 0.406494 21.2109 0.406494C19.2018 0.406494 17.3943 1.24842 16.1389 2.59037C14.8834 1.24842 13.076 0.406494 11.0669 0.406494ZM20.7859 16.1517C20.7085 16.0829 20.6326 16.0121 20.5582 15.9395L16.1389 11.628L11.7196 15.9395C11.6452 16.0121 11.5692 16.0829 11.4919 16.1517C11.5692 16.2206 11.6452 16.2914 11.7196 16.364L16.1389 20.6755L20.5582 16.364C20.6326 16.2914 20.7085 16.2206 20.7859 16.1517ZM17.9321 23.8743V25.1993C17.9321 26.9659 19.4001 28.3981 21.2109 28.3981C22.0804 28.3981 22.9144 28.0611 23.5293 27.4612L28.6914 22.425V21.1C28.6914 19.3334 27.2234 17.9012 25.4126 17.9012C24.5431 17.9012 23.7091 18.2382 23.0942 18.8381L17.9321 23.8743ZM14.3457 23.8743L9.18359 18.8381C8.5687 18.2382 7.73476 17.9012 6.86518 17.9012C5.05437 17.9012 3.58642 19.3334 3.58642 21.1V22.425L8.74849 27.4612C9.36338 28.0611 10.1974 28.3981 11.0669 28.3981C12.8777 28.3981 14.3457 26.9659 14.3457 25.1993V23.8743ZM14.3457 7.10423V8.42917L9.18359 13.4654C8.5687 14.0653 7.73476 14.4023 6.86518 14.4023C5.05437 14.4023 3.58642 12.9701 3.58642 11.2035V9.87852L8.74849 4.84234C9.36338 4.24245 10.1974 3.90544 11.0669 3.90544C12.8777 3.90544 14.3457 5.33758 14.3457 7.10423ZM23.0942 13.4654L17.9321 8.42917V7.10423C17.9321 5.33758 19.4001 3.90544 21.2109 3.90544C22.0804 3.90544 22.9144 4.24245 23.5293 4.84234L28.6914 9.87852V11.2035C28.6914 12.9701 27.2234 14.4023 25.4126 14.4023C24.5431 14.4023 23.7091 14.0653 23.0942 13.4654Z" fill="#0D25FF"/>
                    </g>
                    <defs>
                        <clipPath id="clip0_11899_3653">
                            <rect width="32.2778" height="32.2778" fill="white"/>
                        </clipPath>
                    </defs>
                </svg>
            </div>
            <span className="text-2xl font-bold tracking-tight text-blue-600">Theraptly</span>
        </div>
    );
}

function AutoLoginContent() {
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [loadingMessage, setLoadingMessage] = useState('Validating your access...');
    const [error, setError] = useState('');
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    const performAutoLogin = async (token: string | null, redirectTo: string | null) => {
        try {
            if (!token) {
                setError('No login token provided');
                setStatus('error');
                return;
            }

            // Step 1: Validate the auto-login token
            setLoadingMessage('Validating your secure access link...');
            const response = await fetch('/api/auth/auto-login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token }),
            });

            const result = await response.json();

            if (!result.isValid) {
                setError(result.error || 'Invalid login token');
                setStatus('error');
                return;
            }

            // Step 2: Create secure session
            setLoadingMessage('Setting up your training access...');
            await new Promise(resolve => setTimeout(resolve, 800)); // Brief pause for UX

            const adminResponse = await fetch('/api/auth/admin-signin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userId: result.userId, email: result.email }),
            });

            const adminResult = await adminResponse.json();

            console.log('Admin sign-in response:', adminResult);

            if (!adminResult.success) {
                console.error('Admin sign-in failed:', adminResult.error);
                setError('Failed to authenticate user: ' + (adminResult.error || 'Unknown error'));
                setStatus('error');
                return;
            }

            // Step 3: Establish session
            setLoadingMessage('Preparing your course materials...');

            // Set session with tokens from admin API
            if (adminResult.session && adminResult.session.access_token && adminResult.session.refresh_token) {
                try {
                    console.log('Setting session with tokens from admin API');

                    const { error: sessionError } = await supabase.auth.setSession({
                        access_token: adminResult.session.access_token,
                        refresh_token: adminResult.session.refresh_token,
                    });

                    if (sessionError) {
                        console.error('Session error:', sessionError);
                        setError('Failed to establish session: ' + sessionError.message);
                        setStatus('error');
                        return;
                    }

                    console.log('Session established successfully');
                } catch (sessionSetError) {
                    console.error('Error setting session:', sessionSetError);
                    setError('Failed to process session');
                    setStatus('error');
                    return;
                }
            } else {
                console.error('No session tokens received from admin API');
                console.log('Admin result:', adminResult);
                setError('Failed to receive authentication data. Please try again or contact support.');
                setStatus('error');
                return;
            }

            // Step 4: Success
            setLoadingMessage('Welcome! Taking you to your training...');
            await new Promise(resolve => setTimeout(resolve, 600)); // Brief pause
            setStatus('success');

            // Redirect to the specified page (from token) or fallback
            const destination = result.redirectTo || redirectTo || '/worker/courses';

            setTimeout(() => {
                router.push(destination);
            }, 1000);

        } catch (err) {
            console.error('Auto-login error:', err);
            setError('Failed to process login');
            setStatus('error');
        }
    };

    useEffect(() => {
        const token = searchParams.get('token');
        const redirectTo = searchParams.get('redirect');

        performAutoLogin(token, redirectTo);
    }, [searchParams]);

    if (status === 'loading') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <TheraptlyLogo className="mb-6" />
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">Setting Up Your Access</h2>
                    <p className="text-slate-500 mb-4">{loadingMessage}</p>
                    <div className="flex justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'success') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <TheraptlyLogo className="mb-6" />
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">Welcome!</h2>
                    <p className="text-slate-500">You&apos;ve been successfully signed in. Redirecting to your training...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto p-6">
                <TheraptlyLogo className="mb-6" />
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </div>
                <h2 className="text-xl font-semibold text-slate-900 mb-2">Access Denied</h2>
                <p className="text-slate-600 mb-6">{error}</p>
                <p className="text-sm text-slate-500 mb-6">
                    This link may have expired or been used already. Please contact your administrator for a new access link.
                </p>
                <button
                    onClick={() => router.push('/login')}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                >
                    Go to Login
                </button>
            </div>
        </div>
    );
}

export default function AutoLoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <TheraptlyLogo className="mb-6" />
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">Loading...</h2>
                    <div className="flex justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                </div>
            </div>
        }>
            <AutoLoginContent />
        </Suspense>
    );
}
