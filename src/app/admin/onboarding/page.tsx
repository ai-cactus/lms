"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, Circle, Upload, Users, Eye, LayoutDashboard } from "lucide-react";

interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    icon: React.ReactNode;
    action?: () => void;
    buttonText?: string;
}

export default function AdminOnboarding() {
    const [steps, setSteps] = useState<OnboardingStep[]>([]);
    const [currentStep, setCurrentStep] = useState(0);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        checkOnboardingStatus();
    }, []);

    const checkOnboardingStatus = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Check what steps are completed
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            const { data: policies } = await supabase
                .from("policies")
                .select("id")
                .eq("organization_id", userData?.organization_id)
                .limit(1);

            const { data: courses } = await supabase
                .from("courses")
                .select("id")
                .eq("organization_id", userData?.organization_id)
                .not("published_at", "is", null)
                .limit(1);

            const { data: workers } = await supabase
                .from("users")
                .select("id")
                .eq("organization_id", userData?.organization_id)
                .eq("role", "worker")
                .limit(1);

            const { data: assignments } = await supabase
                .from("course_assignments")
                .select("id")
                .limit(1);

            const onboardingSteps: OnboardingStep[] = [
                {
                    id: "email",
                    title: "Verify Email",
                    description: "Confirm your email address",
                    completed: user.email_confirmed_at !== null,
                    icon: <CheckCircle className="w-5 h-5" />,
                },
                {
                    id: "organization",
                    title: "Set Up Organization Profile",
                    description: "Complete your organization details",
                    completed: !!userData?.organization_id,
                    icon: <Circle className="w-5 h-5" />,
                    action: () => router.push("/admin/organization/setup"),
                    buttonText: "Complete Profile",
                },
                {
                    id: "policy",
                    title: "Upload First Policy",
                    description: "Upload a policy document to generate your first course",
                    completed: (policies?.length || 0) > 0,
                    icon: <Upload className="w-5 h-5" />,
                    action: () => router.push("/admin/policies/upload"),
                    buttonText: "Upload Policy (DOCX/PDF)",
                },
                {
                    id: "course",
                    title: "Review & Approve Course Draft",
                    description: "Review AI-generated course and approve for publishing",
                    completed: (courses?.length || 0) > 0,
                    icon: <Eye className="w-5 h-5" />,
                    action: () => router.push("/admin/courses"),
                    buttonText: "Review Course",
                },
                {
                    id: "workers",
                    title: "Add Workers & Assign Roles",
                    description: "Add staff members and assign their roles",
                    completed: (workers?.length || 0) > 0,
                    icon: <Users className="w-5 h-5" />,
                    action: () => router.push("/admin/workers/add"),
                    buttonText: "Add Staff",
                },
                {
                    id: "assign",
                    title: "Confirm First Training Assigned",
                    description: "Assign courses to workers to get started",
                    completed: (assignments?.length || 0) > 0,
                    icon: <CheckCircle className="w-5 h-5" />,
                    action: () => router.push("/admin/workers"),
                    buttonText: "Publish to Workers",
                },
                {
                    id: "dashboard",
                    title: "View Compliance Dashboard",
                    description: "Monitor your team's training progress",
                    completed: false,
                    icon: <LayoutDashboard className="w-5 h-5" />,
                    action: () => router.push("/admin/dashboard"),
                    buttonText: "Go to Dashboard",
                },
            ];

            setSteps(onboardingSteps);

            // Find first incomplete step
            const firstIncomplete = onboardingSteps.findIndex(s => !s.completed);
            setCurrentStep(firstIncomplete === -1 ? onboardingSteps.length - 1 : firstIncomplete);

            setLoading(false);
        } catch (error) {
            console.error("Error checking onboarding status:", error);
            setLoading(false);
        }
    };

    const completedCount = steps.filter(s => s.completed).length;
    const progress = (completedCount / steps.length) * 100;
    const allComplete = completedCount === steps.length;

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Welcome to Compliance Training
                    </h1>
                    <p className="text-lg text-slate-600">
                        Let&apos;s get you audit-ready.
                    </p>
                </div>

                {/* Progress Bar */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-700">
                            Step {completedCount} of {steps.length} Complete
                        </span>
                        <span className="text-sm text-slate-500">{Math.round(progress)}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-indigo-600 transition-all duration-500"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* All Complete Banner */}
                {allComplete && (
                    <div className="mb-8 p-6 bg-green-50 border border-green-200 rounded-xl">
                        <div className="flex items-center gap-3">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                            <div>
                                <h3 className="font-semibold text-green-900">All setup steps complete!</h3>
                                <p className="text-sm text-green-700">You are audit-ready.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Checklist */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 divide-y divide-gray-200">
                    {steps.map((step, index) => (
                        <div
                            key={step.id}
                            className={`p-6 ${index === currentStep && !step.completed ? "bg-indigo-50/50" : ""
                                }`}
                        >
                            <div className="flex items-start gap-4">
                                {/* Icon */}
                                <div
                                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${step.completed
                                        ? "bg-green-100 text-green-600"
                                        : index === currentStep
                                            ? "bg-indigo-100 text-indigo-600"
                                            : "bg-gray-100 text-gray-400"
                                        }`}
                                >
                                    {step.completed ? (
                                        <CheckCircle className="w-5 h-5" />
                                    ) : (
                                        step.icon
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1">
                                    <h3 className="font-semibold text-slate-900 mb-1">{step.title}</h3>
                                    <p className="text-sm text-slate-600 mb-3">{step.description}</p>

                                    {/* Action Button */}
                                    {!step.completed && step.action && index === currentStep && (
                                        <button
                                            onClick={step.action}
                                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                                        >
                                            {step.buttonText}
                                        </button>
                                    )}

                                    {step.completed && (
                                        <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
                                            <CheckCircle className="w-4 h-4" />
                                            Completed
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Skip to Dashboard */}
                <div className="mt-6 text-center">
                    <button
                        onClick={() => router.push("/admin/dashboard")}
                        className="text-sm text-slate-600 hover:text-slate-900"
                    >
                        Skip to Dashboard →
                    </button>
                </div>
            </div>
        </div>
    );
}
