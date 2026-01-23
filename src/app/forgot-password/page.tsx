"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Mail, CheckCircle2, ShieldCheck, Smartphone } from "lucide-react"; // Using Lucide for consistency
import { requestPasswordReset } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const result = await requestPasswordReset(email);

        if (result.success) {
            setSuccess(true);
        } else {
            setError(result.error || "Failed to send reset email");
        }

        setLoading(false);
    };

    return (
        <div className="h-screen w-full flex bg-white font-sans overflow-hidden">
            {/* Left Section - Form */}
            <div className="w-full lg:w-1/2 h-full flex flex-col justify-center items-center p-6 lg:p-12 gap-6">

                {/* Logo */}
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
                    <Link
                        href="/login"
                        className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-8 font-medium"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Login
                    </Link>

                    {success ? (
                        <div className="text-center">
                            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Mail className="w-8 h-8 text-green-600" />
                            </div>
                            <h1 className="text-3xl font-bold text-text-primary mb-3">Check your email</h1>
                            <p className="text-text-secondary text-lg mb-8">
                                We&apos;ve sent a password reset link to<br />
                                <span className="font-semibold text-text-primary">{email}</span>
                            </p>
                            <p className="text-sm text-text-tertiary mb-8">
                                The link will expire in 1 hour. Be sure to check your spam folder.
                            </p>
                            <button
                                onClick={() => router.push("/login")}
                                className="w-full py-4 bg-brand-primary text-white rounded-xl font-bold text-lg hover:bg-brand-hover transition-all"
                            >
                                Return to Login
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="mb-8">
                                <h1 className="text-3xl font-bold text-text-primary mb-3">Forgot Password?</h1>
                                <p className="text-text-secondary text-lg">
                                    Don&apos;t worry! It happens. Please enter the email associated with your account.
                                </p>
                            </div>

                            {error && (
                                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium flex items-center gap-2">
                                    <span className="w-1 h-1 rounded-full bg-red-600" />
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div>
                                    <label htmlFor="email" className="block text-sm font-medium text-text-secondary mb-2">
                                        Email Address
                                    </label>
                                    <div className="relative">
                                        <input
                                            id="email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            className="w-full px-4 py-4 bg-[#F7FAFC] border border-border-default rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all text-text-primary placeholder:text-text-tertiary"
                                            placeholder="Enter your email"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-4 bg-brand-primary text-white rounded-xl font-bold text-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20"
                                >
                                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Send Reset Link"}
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
                            Secure Access,<br />Always.
                        </h2>
                        <p className="text-white/80 text-lg">
                            We prioritize the security of your data and compliance information above all else.
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
