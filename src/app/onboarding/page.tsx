"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Briefcase, User, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function OnboardingPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [role, setRole] = useState<"agency_owner" | "worker" | null>(null);
    const [initializing, setInitializing] = useState(true);
    const supabase = createClient();

    // Check auth on mount
    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                // Ideally, we might want to wait a bit or check if there's a session.
                // For now, if no user, redirect to login.
                router.replace("/login");
                return;
            }
            setInitializing(false);
        };
        checkUser();
    }, [router, supabase]);

    const handleContinue = async () => {
        if (!role) return;
        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) throw new Error("No user found");

            // Update user role
            const { error } = await supabase
                .from("users")
                .update({ role })
                .eq("id", user.id);

            if (error) throw error;

            // Redirect based on role
            if (role === "agency_owner") {
                router.push("/admin/dashboard");
            } else {
                router.push("/worker/dashboard");
            }
        } catch (err) {
            console.error("Error updating role:", err);
            // Optionally show error toast
        } finally {
            setLoading(false);
        }
    };

    if (initializing) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-white">
                <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
            </div>
        );
    }

    return (
        <div className="h-screen w-full flex bg-white font-sans overflow-hidden">
            {/* Left Section - Role Selection */}
            <div className="w-full lg:w-1/2 h-full flex flex-col justify-center items-center p-6 lg:p-12 gap-6">
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

                {/* Content Container */}
                <div className="w-full max-w-[480px] flex flex-col gap-8">
                    {/* Header */}
                    <div className="text-center space-y-2">
                        <h1 className="text-3xl font-bold text-text-primary">
                            Tell us about your role
                        </h1>
                        <p className="text-text-secondary text-lg">
                            Choose the option that best describes you to help us tailor your experience.
                        </p>
                    </div>

                    {/* Selection Cards */}
                    <div className="flex flex-col gap-4">
                        {/* Agency Owner Card */}
                        <button
                            onClick={() => setRole("agency_owner")}
                            className={cn(
                                "relative w-full p-6 rounded-[16px] border-2 transition-all duration-200 flex items-start gap-4 text-left group",
                                role === "agency_owner"
                                    ? "bg-brand-primary/5 border-brand-primary shadow-lg shadow-brand-primary/10"
                                    : "bg-white border-border-default hover:border-brand-primary/50"
                            )}
                        >
                            <div className={cn(
                                "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                                role === "agency_owner" ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-500 group-hover:text-brand-primary group-hover:bg-brand-primary/10"
                            )}>
                                <Briefcase className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                                <h3 className={cn("text-lg font-bold mb-1", role === "agency_owner" ? "text-brand-primary" : "text-text-primary")}>
                                    Agency Owner
                                </h3>
                                <p className="text-text-secondary text-sm">
                                    I own or manage a home health agency and want to manage my team and compliance.
                                </p>
                            </div>
                            <div className="shrink-0 mt-1">
                                {role === "agency_owner" ? (
                                    <div className="w-6 h-6 rounded-full bg-brand-primary flex items-center justify-center">
                                        <div className="w-2.5 h-2.5 rounded-full bg-white" />
                                    </div>
                                ) : (
                                    <div className="w-6 h-6 rounded-full border-2 border-slate-300" />
                                )}
                            </div>
                        </button>

                        {/* Worker Card */}
                        <button
                            onClick={() => setRole("worker")}
                            className={cn(
                                "relative w-full p-6 rounded-[16px] border-2 transition-all duration-200 flex items-start gap-4 text-left group",
                                role === "worker"
                                    ? "bg-brand-primary/5 border-brand-primary shadow-lg shadow-brand-primary/10"
                                    : "bg-white border-border-default hover:border-brand-primary/50"
                            )}
                        >
                            <div className={cn(
                                "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                                role === "worker" ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-500 group-hover:text-brand-primary group-hover:bg-brand-primary/10"
                            )}>
                                <User className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                                <h3 className={cn("text-lg font-bold mb-1", role === "worker" ? "text-brand-primary" : "text-text-primary")}>
                                    Worker
                                </h3>
                                <p className="text-text-secondary text-sm">
                                    I am a caregiver or nurse looking to manage my schedule and documentation.
                                </p>
                            </div>
                            <div className="shrink-0 mt-1">
                                {role === "worker" ? (
                                    <div className="w-6 h-6 rounded-full bg-brand-primary flex items-center justify-center">
                                        <div className="w-2.5 h-2.5 rounded-full bg-white" />
                                    </div>
                                ) : (
                                    <div className="w-6 h-6 rounded-full border-2 border-slate-300" />
                                )}
                            </div>
                        </button>
                    </div>

                    {/* Continue Button */}
                    <button
                        onClick={handleContinue}
                        disabled={!role || loading}
                        className={cn(
                            "w-full py-4 rounded-xl text-white font-bold text-lg transition-all",
                            role
                                ? "bg-brand-primary hover:bg-brand-hover shadow-lg shadow-brand-primary/20"
                                : "bg-gray-300 cursor-not-allowed"
                        )}
                    >
                        {loading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : "Continue"}
                    </button>
                </div>
            </div>

            {/* Right Section - Visuals (Reused from previous implementations) */}
            <div className="hidden lg:flex w-1/2 p-2.5 h-full">
                <div className="w-full h-full bg-brand-sidebar rounded-[22px] relative overflow-hidden flex items-center justify-center">
                    <Image
                        src="/assets/onboarding/bg-vectors.svg"
                        alt="Background Pattern"
                        fill
                        className="object-cover opacity-50"
                    />

                    <div className="relative z-10 p-12 w-full max-w-2xl text-white">
                        <h2 className="text-4xl font-bold mb-4 leading-tight">
                            Start your journey with<br />Theraptly today.
                        </h2>
                        <p className="text-white/80 text-lg mb-12">
                            Join thousands of agencies and caregivers simplifying their workflow.
                        </p>

                        {/* Feature Grid Miniatures - Simplified for this view if needed, 
                             or we can keep the full grid from before if it matches design. 
                             The user linked to the same design file so the right side should likely be similar.
                             I'll stick to a simpler promotional message or reuse the complex grid if I have it exact.
                             Actually, let's keep it consistent with Login/Signup right side if they are the same.
                             Login/Signup right side had the 4-grid.
                             Let's reuse the 4-grid logic from Login/Signup for consistency.
                         */}
                        <div className="grid grid-cols-2 gap-6">
                            {[
                                { title: "Policy Analyzer", desc: "AI-powered compliance checks" },
                                { title: "Compliance Scoring", desc: " Performance-based metrics" },
                                { title: "Billing Management", desc: "Flexible subscription tools" },
                                { title: "Secure Storage", desc: "HIPAA compliant cloud" }
                            ].map((item, i) => (
                                <div key={i} className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/10">
                                    <div className="w-8 h-8 bg-white text-brand-primary rounded-lg flex items-center justify-center mb-3">
                                        <CheckCircle2 className="w-5 h-5" />
                                    </div>
                                    <h3 className="font-bold text-sm mb-1">{item.title}</h3>
                                    <p className="text-xs text-white/70">{item.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
