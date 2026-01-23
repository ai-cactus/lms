"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Lock, CheckCircle2, XCircle, ShieldCheck, Smartphone } from "lucide-react";
import { updatePassword } from "@/app/actions/auth";
import PasswordStrengthMeter, { validatePassword } from "@/components/PasswordStrengthMeter";

export default function ResetPasswordPage() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const [isValidSession, setIsValidSession] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setIsValidSession(!!session);

            if (!session) {
                setError("Invalid or expired reset link. Please request a new one.");
            }
        };
        checkSession();
    }, [supabase]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        if (!validatePassword(password)) {
            setError("Password does not meet all requirements");
            return;
        }

        setLoading(true);

        const result = await updatePassword(password);

        if (result.success) {
            setSuccess(true);
            setTimeout(() => {
                router.push("/login");
            }, 3000);
        } else {
            setError(result.error || "Failed to update password");
        }

        setLoading(false);
    };

    return (
        <div className="h-screen w-full flex bg-white font-sans overflow-hidden">
            {/* Left Section - Form */}
            <div className="w-full lg:w-1/2 h-full flex flex-col justify-center items-center p-6 lg:p-12 gap-6">

                <div className="flex justify-center mb-4">
                    <Image
                        src="/assets/onboarding/logo-light.svg"
                        alt="Theraptly Logo"
                        width={180}
                        height={60}
                        priority
                    />
                </div>

                <div className="w-full max-w-[440px]">
                    {success ? (
                        <div className="text-center">
                            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle2 className="w-8 h-8 text-green-600" />
                            </div>
                            <h1 className="text-3xl font-bold text-text-primary mb-3">Password Updated!</h1>
                            <p className="text-text-secondary text-lg mb-8">
                                Your password has been successfully reset. You will be redirected to login shortly.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="mb-8 text-center lg:text-left">
                                <h1 className="text-3xl font-bold text-text-primary mb-3">Set new password</h1>
                                <p className="text-text-secondary text-lg">
                                    Please choose a strong password for your account.
                                </p>
                            </div>

                            {error && (
                                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium flex items-center gap-2">
                                    <XCircle className="w-5 h-5 shrink-0" />
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-2">
                                        New Password
                                    </label>
                                    <div className="relative">
                                        <input
                                            id="password"
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            disabled={!isValidSession}
                                            className="w-full px-4 py-4 bg-[#F7FAFC] border border-border-default rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-text-primary disabled:bg-gray-100 disabled:cursor-not-allowed"
                                            placeholder="••••••••"
                                        />
                                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary pointer-events-none" />
                                    </div>

                                    {/* Strength Meter would go here - ensuring it fits layout */}
                                    {password && (
                                        <div className="mt-4">
                                            <PasswordStrengthMeter password={password} />
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-secondary mb-2">
                                        Confirm Password
                                    </label>
                                    <div className="relative">
                                        <input
                                            id="confirmPassword"
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            required
                                            disabled={!isValidSession}
                                            className="w-full px-4 py-4 bg-[#F7FAFC] border border-border-default rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-text-primary disabled:bg-gray-100 disabled:cursor-not-allowed"
                                            placeholder="••••••••"
                                        />
                                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary pointer-events-none" />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading || !isValidSession || !password || password !== confirmPassword}
                                    className="w-full py-4 bg-brand-primary text-white rounded-xl font-bold text-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20"
                                >
                                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Update Password"}
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </div>

            {/* Right Section - Visuals (Reused) */}
            <div className="hidden lg:flex w-1/2 h-full bg-brand-sidebar relative overflow-hidden m-2.5 rounded-[22px]">
                <div className="absolute inset-0 z-0">
                    <Image
                        src="/assets/onboarding/bg-vectors.svg"
                        alt="Background Pattern"
                        fill
                        className="object-cover"
                        style={{ mixBlendMode: 'soft-light' }}
                    />
                </div>

                <div className="relative z-10 flex flex-col justify-center w-full h-full p-[8%] text-white">
                    <div className="mb-12">
                        <h2 className="text-4xl font-bold mb-4 leading-tight">
                            Your Security<br />Is Our Priority
                        </h2>
                        <p className="text-white/80 text-lg">
                            Create a strong password to protect your agency and client data.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        {[
                            { title: "End-to-End Encryption", desc: "Data is always protected" },
                            { title: "Multi-Factor Ready", desc: "Enhanced account security" },
                        ].map((item, i) => (
                            <div key={i} className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/10">
                                <div className="w-8 h-8 bg-white text-brand-primary rounded-lg flex items-center justify-center mb-3">
                                    {i === 0 ? <ShieldCheck className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
                                </div>
                                <h3 className="font-bold text-sm mb-1">{item.title}</h3>
                                <p className="text-xs text-white/70">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
