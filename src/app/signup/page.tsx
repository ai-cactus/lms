"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Hexagon } from "@phosphor-icons/react";

export default function SignupPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [organizationName, setOrganizationName] = useState("");
    const [programType, setProgramType] = useState("Behavioral Health");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();
    const supabase = createClient();

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            // 1. Create auth user with metadata
            // The Postgres Trigger 'on_auth_user_created' will automatically:
            // - Create the Organization
            // - Create the User Profile (linked to the org)
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        organization_name: organizationName,
                        program_type: programType,
                    },
                },
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error("Failed to create user");

            // No need to manually insert into tables anymore!
            // The trigger handles it.

            // Redirect to onboarding
            router.push("/admin/onboarding");
        } catch (err: any) {
            setError(err.message || "Failed to create account");
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

                {/* Signup Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Create your account</h1>
                    <p className="text-slate-500 mb-6">Get started with CARF-compliant training</p>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSignup} className="space-y-4">
                        <div>
                            <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-1">
                                Full Name
                            </label>
                            <input
                                id="fullName"
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                placeholder="John Doe"
                            />
                        </div>

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
                                minLength={8}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                placeholder="••••••••"
                            />
                            <p className="text-xs text-slate-500 mt-1">Minimum 8 characters</p>
                        </div>

                        <div>
                            <label htmlFor="organizationName" className="block text-sm font-medium text-slate-700 mb-1">
                                Organization Name
                            </label>
                            <input
                                id="organizationName"
                                type="text"
                                value={organizationName}
                                onChange={(e) => setOrganizationName(e.target.value)}
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                placeholder="Your Organization"
                            />
                        </div>

                        <div>
                            <label htmlFor="programType" className="block text-sm font-medium text-slate-700 mb-1">
                                Program Type
                            </label>
                            <select
                                id="programType"
                                value={programType}
                                onChange={(e) => setProgramType(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                            >
                                <option>Behavioral Health</option>
                                <option>Substance Abuse Treatment</option>
                                <option>Mental Health Services</option>
                                <option>Integrated Care</option>
                                <option>Other</option>
                            </select>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? "Creating account..." : "Create account"}
                        </button>
                    </form>
                </div>

                <p className="text-center text-sm text-slate-500 mt-6">
                    Already have an account?{" "}
                    <a href="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
                        Sign in
                    </a>
                </p>
            </div>
        </div>
    );
}
