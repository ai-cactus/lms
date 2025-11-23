"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FileText, Download, BookOpen, Upload, AlertCircle } from "lucide-react";

interface Policy {
    id: string;
    title: string;
    file_name: string;
    file_url: string;
    version: number;
    status: "draft" | "published" | "archived";
    created_at: string;
    updated_at: string;
}

export default function DocumentsPage() {
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadPolicies();
    }, []);

    const loadPolicies = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) return;

            // Fetch all policies for the organization
            const { data: policiesData, error } = await supabase
                .from("policies")
                .select("*")
                .eq("organization_id", userData.organization_id)
                .order("created_at", { ascending: false });

            if (error) throw error;

            // Group by file_name to show only unique documents (latest version)
            const uniqueDocuments = new Map<string, Policy>();
            policiesData?.forEach(policy => {
                const existing = uniqueDocuments.get(policy.file_name);
                // Keep the latest version (or first occurrence since we sorted by created_at desc)
                if (!existing) {
                    uniqueDocuments.set(policy.file_name, policy);
                }
            });

            setPolicies(Array.from(uniqueDocuments.values()));
            setLoading(false);
        } catch (error) {
            console.error("Error loading policies:", error);
            setLoading(false);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return date.toLocaleDateString();
    };

    const handleGenerateCourse = (policyId: string) => {
        router.push(`/admin/courses/create?policyId=${policyId}`);
    };

    const handleDownload = (fileUrl: string) => {
        window.open(fileUrl, "_blank");
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-slate-600">Loading documents...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
                    <p className="text-slate-500 mt-1">Manage your uploaded policy documents</p>
                </div>
                <button
                    onClick={() => router.push("/admin/policies/upload")}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                    <Upload className="w-4 h-4" />
                    Upload Document
                </button>
            </div>

            {/* Documents List */}
            {policies.length === 0 ? (
                // Empty State
                <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <FileText className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">No documents yet</h3>
                    <p className="text-slate-500 mb-6 max-w-md mx-auto">
                        Upload your first policy document to get started with creating training courses.
                    </p>
                    <button
                        onClick={() => router.push("/admin/policies/upload")}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                    >
                        <Upload className="w-4 h-4" />
                        Upload Your First Document
                    </button>
                </div>
            ) : (
                // Documents Grid
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {policies.map((policy) => (
                        <div
                            key={policy.id}
                            className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-lg transition-shadow"
                        >
                            {/* Document Icon */}
                            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
                                <FileText className="w-6 h-6 text-blue-600" />
                            </div>

                            {/* Document Info */}
                            <h3 className="text-lg font-bold text-slate-900 mb-2 line-clamp-2">
                                {policy.title}
                            </h3>
                            <p className="text-sm text-slate-500 mb-4 truncate">
                                {policy.file_name}
                            </p>

                            <p className="text-xs text-slate-400 mb-4">
                                Uploaded {formatDate(policy.created_at)}
                            </p>

                            {/* Actions */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleGenerateCourse(policy.id)}
                                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                                >
                                    <BookOpen className="w-4 h-4" />
                                    Generate Course
                                </button>
                                <button
                                    onClick={() => handleDownload(policy.file_url)}
                                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors flex items-center justify-center"
                                    title="Download document"
                                >
                                    <Download className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Info Banner */}
            {policies.length > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900">
                        <p className="font-medium mb-1">Generate courses from your documents</p>
                        <p className="text-blue-700">
                            Click "Generate Course" on any document to create a new training course. Our AI will analyze the document and create lessons and quizzes automatically.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
