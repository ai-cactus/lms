"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Hexagon } from "@phosphor-icons/react";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();
    const supabase = createClient();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            let isLocked = false;

            // Try to check lockout, but don't fail login if this doesn't work
            try {
                const { checkAccountLockout } = await import("@/app/actions/auth");
                const lockoutTime = await checkAccountLockout(email);
                if (lockoutTime) {
                    const minutesRemaining = Math.ceil((lockoutTime.getTime() - Date.now()) / 60000);
                    setError(`Account temporarily locked due to multiple failed login attempts. Please try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`);
                    setLoading(false);
                    isLocked = true;
                    return;
                }
            } catch (lockoutError) {
                console.warn("Could not check account lockout:", lockoutError);
                // Continue with login even if lockout check fails
            }

            if (isLocked) return;

            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                // Try to log failed attempt, but don't block if it fails
                try {
                    const { logLoginAttempt } = await import("@/app/actions/auth");
                    await logLoginAttempt({
                        email,
                        success: false,
                        errorMessage: error.message,
                        userAgent: navigator.userAgent
                    });
                } catch (logError) {
                    console.warn("Could not log failed login attempt:", logError);
                }
                throw error;
            }

            // Get user role from users table
            const { data: userData, error: userError } = await supabase
                .from("users")
                .select("role, organization_id")
                .eq("id", data.user.id)
                .single();

            if (userError) throw userError;

            // Try to log successful attempt, but don't block if it fails
            try {
                const { logLoginAttempt } = await import("@/app/actions/auth");
                await logLoginAttempt({
                    email,
                    success: true,
                    userId: data.user.id,
                    userAgent: navigator.userAgent
                });
            } catch (logError) {
                console.warn("Could not log successful login attempt:", logError);
            }

            // Redirect based on role
            if (userData.role === "admin") {
                router.push("/admin/dashboard");
            } else if (userData.role === "supervisor") {
                router.push("/supervisor/dashboard");
            } else {
                router.push("/worker/dashboard");
            }
        } catch (err: any) {
            setError(err.message || "Failed to login");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="flex items-center justify-center gap-2 mb-8">
                    <Hexagon size={32} weight="fill" className="text-indigo-600" />
                    <span className="text-2xl font-bold text-slate-900">Theraptly</span>
                </div>

                {/* Login Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome back</h1>
                    <p className="text-slate-500 mb-6">Sign in to your account to continue</p>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                placeholder="you@example.com"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                placeholder="••••••••"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? "Signing in..." : "Sign in"}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <a href="/forgot-password" className="text-sm text-indigo-600 hover:text-indigo-700">
                            Forgot your password?
                        </a>
                    </div>
                </div>

                <p className="text-center text-sm text-slate-500 mt-6">
                    Need an account? Contact your administrator.
                </p>
            </div>
        </div>
    );
}
