"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, Loader2, FileSearch, BarChart4, CreditCard, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";

export default function SignupPage() {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [agreeToTerms, setAgreeToTerms] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const router = useRouter();
    const supabase = createClient();

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        if (!agreeToTerms) {
            setError("Please agree to the Terms of Service");
            return;
        }

        setLoading(true);

        try {
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: `${firstName} ${lastName}`.trim(),
                    },
                },
            });

            if (error) throw error;

            // Redirect to onboarding (role selection)
            router.push("/onboarding");
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "An error occurred during signup");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-full flex bg-white font-sans overflow-hidden">
            {/* Left Section - Signup Form */}
            <div
                className="w-full lg:w-1/2 h-full flex flex-col justify-center items-center p-6 lg:p-12 gap-6"
            >
                {/* Logo */}
                <div className="flex justify-center">
                    <Image
                        src="/assets/onboarding/logo-light.svg"
                        alt="Theraptly Logo"
                        width={180}
                        height={60}
                        priority
                    />
                </div>

                {/* Form Container */}
                <div className="flex flex-col items-center w-full max-w-[487px]">
                    <h1 className="text-[28px] font-bold text-text-primary text-center">
                        Create a new account
                    </h1>
                    <p className="text-text-secondary text-center text-sm" style={{ marginTop: '12px', marginBottom: '32px' }}>
                        Enter your personal data to create your account.
                    </p>

                    {error && (
                        <div className="w-full mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSignup} className="w-full space-y-5">
                        {/* First Name and Last Name - 2 columns */}
                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label htmlFor="firstName" className="block text-sm font-medium text-text-primary mb-2">
                                    First Name
                                </label>
                                <input
                                    id="firstName"
                                    type="text"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    required
                                    className="w-full px-4 py-4 border border-border-default rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary outline-none transition-all text-text-primary placeholder-text-tertiary"
                                    placeholder="Enter your first name"
                                />
                            </div>
                            <div>
                                <label htmlFor="lastName" className="block text-sm font-medium text-text-primary mb-2">
                                    Last Name
                                </label>
                                <input
                                    id="lastName"
                                    type="text"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    required
                                    className="w-full px-4 py-4 border border-border-default rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary outline-none transition-all text-text-primary placeholder-text-tertiary"
                                    placeholder="Enter your last name"
                                />
                            </div>
                        </div>

                        {/* Email Address */}
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-2">
                                Email Address
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full px-4 py-4 border border-border-default rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary outline-none transition-all text-text-primary placeholder-text-tertiary"
                                placeholder="Enter your email address"
                            />
                        </div>

                        {/* Password */}
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
                                    placeholder="Password (at least 8 characters long)"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                            {/* Password Strength Meter */}
                            {password && (
                                <div className="mt-3">
                                    <PasswordStrengthMeter password={password} />
                                </div>
                            )}
                        </div>

                        {/* Confirm Password */}
                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-primary mb-2">
                                Confirm Password
                            </label>
                            <div className="relative">
                                <input
                                    id="confirmPassword"
                                    type={showConfirmPassword ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    className="w-full px-4 py-4 border border-border-default rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary outline-none transition-all text-text-primary placeholder-text-tertiary pr-12"
                                    placeholder="Confirm Password (at least 8 characters long)"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                                >
                                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Terms Checkbox */}
                        <div className="flex items-start gap-2 pt-1">
                            <input
                                type="checkbox"
                                id="terms"
                                checked={agreeToTerms}
                                onChange={(e) => setAgreeToTerms(e.target.checked)}
                                className="w-4 h-4 rounded border-border-default text-brand-primary focus:ring-brand-primary mt-0.5"
                            />
                            <label htmlFor="terms" className="text-[13px] font-medium text-text-primary cursor-pointer leading-snug">
                                Yes, I understand and agree to the Theraptly{" "}
                                <Link href="/terms" className="text-brand-primary hover:text-brand-hover">
                                    Terms of Service
                                </Link>
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 bg-brand-primary text-white rounded-xl font-medium text-base hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                            style={{ marginTop: '12px' }}
                        >
                            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Create Account"}
                        </button>
                    </form>
                </div>

                {/* Footer Text */}
                <p className="text-center text-sm text-[#4B4B4B]">
                    Already have an account?{" "}
                    <Link href="/login" className="text-brand-primary hover:text-brand-hover font-medium transition-colors">
                        Sign In
                    </Link>
                </p>
            </div>

            {/* Right Section - Visuals */}
            <div className="hidden lg:flex w-1/2 h-full bg-brand-sidebar relative overflow-hidden m-2.5 rounded-2xl">
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
                        <p className="text-text-white-dim text-sm xl:text-base 2xl:text-lg mt-4 leading-relaxed">
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
                                <p className="text-text-white-dim text-sm font-medium leading-[19px]">
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
                                <p className="text-text-white-dim text-sm font-medium leading-[19px]">
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
                                <p className="text-text-white-dim text-sm font-medium leading-[19px]">
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
                                <p className="text-text-white-dim text-sm font-medium leading-[19px]">
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
