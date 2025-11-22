"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload, FileText, Loader2, CheckCircle, AlertCircle } from "lucide-react";

export default function PolicyUploadPage() {
    const [file, setFile] = useState<File | null>(null);
    const [deliveryFormat, setDeliveryFormat] = useState<'pages' | 'slides'>('pages');
    const [uploading, setUploading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState("");
    const [dragActive, setDragActive] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    }, []);

    const handleFileSelect = (selectedFile: File) => {
        // Validate file type
        const validTypes = [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        ];

        if (!validTypes.includes(selectedFile.type)) {
            setError("Please upload a PDF or DOCX file");
            return;
        }

        // Validate file size (10MB max)
        if (selectedFile.size > 10 * 1024 * 1024) {
            setError("File size must be under 10MB");
            return;
        }

        setFile(selectedFile);
        setError("");
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploading(true);
        setError("");

        try {
            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            // Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) throw new Error("User data not found");

            // Upload file to Supabase Storage
            const fileName = `${Date.now()}-${file.name}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from("policies")
                .upload(`${userData.organization_id}/${fileName}`, file);

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from("policies")
                .getPublicUrl(uploadData.path);

            // Create policy record
            const { data: policyData, error: policyError } = await supabase
                .from("policies")
                .insert({
                    organization_id: userData.organization_id,
                    title: file.name.replace(/\.(pdf|docx?)$/i, ""),
                    file_url: publicUrl,
                    file_name: file.name,
                    status: "draft",
                })
                .select()
                .single();

            if (policyError) throw policyError;

            // Start AI analysis
            setUploading(false);
            setAnalyzing(true);

            // Call AI analysis API
            const response = await fetch("/api/policies/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    policyId: policyData.id,
                    fileUrl: publicUrl,
                    fileName: file.name,
                    deliveryFormat: deliveryFormat,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Analysis failed");
            }

            const { courseId } = await response.json();

            // Redirect to course review
            router.push(`/admin/courses/${courseId}/review`);
        } catch (err: any) {
            console.error("Upload error:", err);
            setError(err.message || "Failed to upload policy");
            setUploading(false);
            setAnalyzing(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Upload Policy Document</h1>
                    <p className="text-slate-600">
                        Upload a policy document to automatically generate a CARF-compliant training course
                    </p>
                </div>

                {/* Upload Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    {!file ? (
                        /* Drag & Drop Zone */
                        <div
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${dragActive
                                ? "border-indigo-500 bg-indigo-50"
                                : "border-gray-300 hover:border-indigo-400"
                                }`}
                        >
                            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">
                                Drop your policy file here
                            </h3>
                            <p className="text-sm text-slate-600 mb-4">or click to browse</p>
                            <input
                                type="file"
                                accept=".pdf,.doc,.docx"
                                onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
                                className="hidden"
                                id="file-upload"
                            />
                            <label
                                htmlFor="file-upload"
                                className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 cursor-pointer transition-colors"
                            >
                                Choose File
                            </label>
                            <p className="text-xs text-slate-500 mt-4">
                                Supported formats: PDF, DOCX (Max 10MB)
                            </p>
                        </div>
                    ) : (
                        /* File Selected */
                        <div>
                            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg mb-6">
                                <FileText className="w-8 h-8 text-indigo-600" />
                                <div className="flex-1">
                                    <p className="font-medium text-slate-900">{file.name}</p>
                                    <p className="text-sm text-slate-500">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </p>
                                </div>
                                {!uploading && !analyzing && (
                                    <button
                                        onClick={() => setFile(null)}
                                        className="text-sm text-slate-600 hover:text-slate-900"
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>

                            {/* Delivery Format Selector */}
                            {!analyzing && (
                                <div className="mb-6">
                                    <label className="block text-sm font-medium text-slate-700 mb-3">
                                        Choose Delivery Format
                                    </label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <label className={`relative p-4 border-2 rounded-lg cursor-pointer transition-all ${deliveryFormat === 'pages'
                                                ? 'border-indigo-600 bg-indigo-50'
                                                : 'border-gray-200 hover:border-gray-300'
                                            }`}>
                                            <input
                                                type="radio"
                                                name="delivery_format"
                                                value="pages"
                                                checked={deliveryFormat === 'pages'}
                                                onChange={() => setDeliveryFormat('pages')}
                                                className="sr-only"
                                            />
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${deliveryFormat === 'pages' ? 'border-indigo-600' : 'border-gray-300'
                                                    }`}>
                                                    {deliveryFormat === 'pages' && (
                                                        <div className="w-2 h-2 rounded-full bg-indigo-600" />
                                                    )}
                                                </div>
                                                <h4 className="font-semibold text-slate-900">Pages View</h4>
                                            </div>
                                            <p className="text-xs text-slate-600">Continuous scrolling text</p>
                                        </label>

                                        <label className={`relative p-4 border-2 rounded-lg cursor-pointer transition-all ${deliveryFormat === 'slides'
                                                ? 'border-indigo-600 bg-indigo-50'
                                                : 'border-gray-200 hover:border-gray-300'
                                            }`}>
                                            <input
                                                type="radio"
                                                name="delivery_format"
                                                value="slides"
                                                checked={deliveryFormat === 'slides'}
                                                onChange={() => setDeliveryFormat('slides')}
                                                className="sr-only"
                                            />
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${deliveryFormat === 'slides' ? 'border-indigo-600' : 'border-gray-300'
                                                    }`}>
                                                    {deliveryFormat === 'slides' && (
                                                        <div className="w-2 h-2 rounded-full bg-indigo-600" />
                                                    )}
                                                </div>
                                                <h4 className="font-semibold text-slate-900">Slides View</h4>
                                            </div>
                                            <p className="text-xs text-slate-600">Interactive presentation format</p>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {error && (
                                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-700">{error}</p>
                                </div>
                            )}

                            {analyzing ? (
                                /* Analyzing State */
                                <div className="text-center py-8">
                                    <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold text-slate-900 mb-2">
                                        Analyzing with AI...
                                    </h3>
                                    <p className="text-sm text-slate-600">
                                        This may take up to 60 seconds. We&apos;re extracting content, identifying
                                        objectives, and mapping to CARF standards.
                                    </p>
                                </div>
                            ) : (
                                /* Upload Button */
                                <button
                                    onClick={handleUpload}
                                    disabled={uploading}
                                    className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                >
                                    {uploading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-5 h-5" />
                                            Upload Policy
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Info Section */}
                <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-xl">
                    <h3 className="font-semibold text-blue-900 mb-2">What happens next?</h3>
                    <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                        <li>AI analyzes your policy document</li>
                        <li>Generates course objectives mapped to CARF standards</li>
                        <li>Creates lesson notes and quiz questions</li>
                        <li>You review and approve the course draft</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}
