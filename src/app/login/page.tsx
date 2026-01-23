"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff, Loader2, FileSearch, BarChart4, CreditCard, Lock } from "lucide-react";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
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
        <div className="h-screen w-full flex bg-white font-sans overflow-hidden">
            {/* Left Section - Login Form */}
            <div
                className="w-full lg:w-1/2 h-full flex flex-col justify-center items-center p-6 lg:p-12 gap-6"
            >
                {/* Logo */}
                <div className="flex justify-center">
                    <Image
                        src="/assets/onboarding/logo-light.svg"
                        alt="Theraptly Logo"
                        width={213}
                        height={72}
                        priority
                    />
                </div>

                {/* Form Container - 32px gap from logo */}
                <div className="flex flex-col items-center w-full max-w-[487px]">
                    <h1 className="text-[28px] font-bold text-text-primary text-center">
                        Log in to your account
                    </h1>
                    {/* 26px gap after subtitle */}
                    <p className="text-text-secondary text-center text-base" style={{ marginTop: '12px', marginBottom: '32px' }}>
                        Welcome back! Please enter your details
                    </p>

                    {error && (
                        <div className="w-full mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="w-full space-y-5">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-2">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full px-4 py-4 border border-border-default rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary outline-none transition-all text-text-primary placeholder-text-tertiary"
                                placeholder="Enter your work email"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="w-full px-4 py-4 border border-border-default rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary outline-none transition-all text-text-primary placeholder-text-tertiary pr-12"
                                    placeholder="Enter your password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" className="w-4 h-4 rounded border-border-default text-brand-primary focus:ring-brand-primary" />
                                <span className="text-sm text-text-secondary">Remember me</span>
                            </label>
                            <Link href="/forgot-password" className="text-sm text-brand-primary hover:text-brand-hover font-medium transition-colors">
                                Forget Password?
                            </Link>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 bg-brand-primary text-white rounded-xl font-medium text-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                            style={{ height: '64px' }}
                        >
                            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Login"}
                        </button>
                    </form>
                </div>

                {/* Footer Text - 22px gap from button */}
                <p className="text-center text-base text-[#4B4B4B]" style={{ marginTop: '22px' }}>
                    Don&apos;t have an account?{" "}
                    <Link href="/signup" className="text-brand-primary hover:text-brand-hover font-medium transition-colors">
                        Sign Up
                    </Link>
                </p>
            </div>

            {/* Right Section - Visuals */}
            <div className="hidden lg:flex w-1/2 h-full bg-brand-sidebar relative overflow-hidden m-2.5 rounded-[22px]">
                {/* Background Vectors */}
                <div className="absolute inset-0 z-0">
                    <Image
                        src="/assets/onboarding/bg-vectors.svg"
                        alt="Background Pattern"
                        fill
                        className="object-cover"
                        style={{ mixBlendMode: 'soft-light' }}
                    />
                </div>

                {/* Content Container - Responsive and fills space */}
                <div className="relative z-10 flex flex-col justify-center w-full h-full p-[8%]">
                    {/* Header Text */}
                    <div className="mb-[8%]">
                        <h2 className="text-2xl xl:text-[32px] 2xl:text-4xl font-bold text-white leading-tight">
                            Take the Stress Out of your<br />Compliance Today
                        </h2>
                        <p className="text-[#CFD9E0] text-sm xl:text-base 2xl:text-lg mt-4 leading-relaxed">
                            Powerful tools to simplify, streamline and strengthen your CARF compliance processes, all in one place.
                        </p>
                    </div>

                    {/* Features Grid - 2x2 responsive */}
                    <div className="grid grid-cols-2 gap-[6%]">
                        {/* Policy Analyzer */}
                        <div className="flex flex-col gap-3">
                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary">
                                <FileSearch className="w-6 h-6" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <h3 className="text-[19px] font-semibold text-[#F7FAFC]">Policy Analyzer</h3>
                                <p className="text-[#CFD9E0] text-sm font-medium leading-[19px]">
                                    Instantly detect non-compliant content in your policy documents with AI-powered analysis.
                                </p>
                            </div>
                        </div>

                        {/* Compliance Scoring */}
                        <div className="flex flex-col gap-3">
                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary">
                                <BarChart4 className="w-6 h-6" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <h3 className="text-[19px] font-semibold text-[#F7FAFC]">Compliance Scoring</h3>
                                <p className="text-[#CFD9E0] text-sm font-medium leading-[19px]">
                                    Receive a percentage-based score for easy evaluation and quick decision-making.
                                </p>
                            </div>
                        </div>

                        {/* Billing & Plan Management */}
                        <div className="flex flex-col gap-3">
                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary">
                                <CreditCard className="w-6 h-6" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <h3 className="text-[19px] font-semibold text-[#F7FAFC]">Billing & Plan Management</h3>
                                <p className="text-[#CFD9E0] text-sm font-medium leading-[19px]">
                                    Flexible subscription options designed to fit your needs.
                                </p>
                            </div>
                        </div>

                        {/* Secure Cloud Storage */}
                        <div className="flex flex-col gap-3">
                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary">
                                <Lock className="w-6 h-6" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <h3 className="text-[19px] font-semibold text-[#F7FAFC]">Secure Cloud Storage</h3>
                                <p className="text-[#CFD9E0] text-sm font-medium leading-[19px]">
                                    Keep all your sensitive compliance documents safe and accessible anytime, anywhere.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
