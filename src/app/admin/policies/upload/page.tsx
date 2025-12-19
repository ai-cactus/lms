"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CloudUpload, FileText, AlertTriangle } from "lucide-react";
import { validateDocumentForProcessing, getValidFileTypes, formatFileSize } from "@/lib/document-validation";

export default function PolicyUploadPage() {
    const [file, setFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState("");
    const [warning, setWarning] = useState("");
    const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
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

    const handleFileSelect = async (selectedFile: File) => {
        // Use new validation system
        const validation = validateDocumentForProcessing(selectedFile);
        
        if (!validation.isValid) {
            setError(validation.error || "Invalid file");
            setWarning("");
            return;
        }

        setFile(selectedFile);
        setError("");
        setWarning(validation.warning || "");

        // Auto-upload the file
        await uploadFile(selectedFile);
    };

    const uploadFile = async (fileToUpload: File) => {
        setUploading(true);
        setUploadProgress(0);
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

            // Simulate progress
            setUploadProgress(30);

            // Upload file to Supabase Storage
            const fileName = `${Date.now()}-${fileToUpload.name}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from("policies")
                .upload(`${userData.organization_id}/${fileName}`, fileToUpload);

            if (uploadError) throw uploadError;

            setUploadProgress(60);

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from("policies")
                .getPublicUrl(uploadData.path);

            setUploadProgress(80);

            // Create policy record
            const { data: policyData, error: policyError } = await supabase
                .from("policies")
                .insert({
                    organization_id: userData.organization_id,
                    title: fileToUpload.name.replace(/\.(pdf|docx?)$/i, ""),
                    file_url: publicUrl,
                    file_name: fileToUpload.name,
                    status: "draft",
                })
                .select()
                .single();

            if (policyError) throw policyError;

            setUploadProgress(100);
            setUploadedFileId(policyData.id);
            setUploading(false);
        } catch (err: any) {
            console.error("Upload error:", err);
            setError(err.message || "Failed to upload policy");
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleViewWorkspace = () => {
        if (uploadedFileId) {
            router.push(`/admin/courses/create?policyId=${uploadedFileId}`);
        }
    };

    return (
        <div className="space-y-6">
            {/* Upload Card with Blue Border */}
            <div className="bg-white rounded-xl border-2 border-blue-500 p-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-blue-600 mb-2">Upload Your Policy</h1>
                    <p className="text-slate-600">
                        Upload your document here to get started! Accepted formats include PDF and DOCX.
                    </p>
                </div>

                {/* Drag & Drop Zone */}
                <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl py-20 px-16 text-center transition-colors ${dragActive
                            ? "border-blue-400 bg-blue-50"
                            : "border-gray-300"
                        }`}
                >
                    {/* Cloud Upload Icon */}
                    <div className="flex justify-center mb-6">
                        <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center">
                            <CloudUpload className="w-12 h-12 text-slate-400" strokeWidth={1.5} />
                        </div>
                    </div>

                    <h3 className="text-xl font-bold text-slate-900 mb-2">
                        Drag & drop your files here
                    </h3>
                    <p className="text-sm text-slate-400 mb-1">
                        PDF (max 25MB), DOCX (max 50MB), TXT/MD (max 10MB)
                    </p>
                    <p className="text-sm text-slate-400 mb-6">or</p>

                    {/* Select File Button */}
                    <input
                        type="file"
                        accept=".pdf,.doc,.docx,.txt,.md"
                        onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
                        className="hidden"
                        id="file-upload"
                        disabled={uploading}
                    />
                    <label
                        htmlFor="file-upload"
                        className={`inline-block px-10 py-3 rounded-lg font-semibold text-sm uppercase tracking-wide transition-colors ${uploading
                                ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                                : "bg-slate-400 text-white hover:bg-white0 cursor-pointer"
                            }`}
                    >
                        SELECT FILE
                    </label>

                    {/* Error Message */}
                    {error && (
                        <div className="mt-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-red-700">{error}</p>
                        </div>
                    )}
                    
                    {/* Warning Message */}
                    {warning && (
                        <div className="mt-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-amber-700">{warning}</p>
                        </div>
                    )}
                </div>

                {/* Uploaded File Display with Progress */}
                {file && (
                    <div className="mt-8 pt-6 border-t-2 border-dashed border-blue-400">
                        <div className="flex items-center justify-between gap-4 p-4 bg-white rounded-lg">
                            <div className="flex items-center gap-4 flex-1">
                                {/* PDF Icon */}
                                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <FileText className="w-6 h-6 text-red-600" />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="font-semibold text-slate-900 truncate">
                                            {file.name}
                                        </p>
                                        <span className="text-sm text-slate-500 ml-4">
                                            {(file.size / 1024 / 1024).toFixed(1)} MB
                                        </span>
                                    </div>

                                    {/* Progress Bar */}
                                    {uploading && (
                                        <div className="w-full bg-slate-200 rounded-full h-2">
                                            <div
                                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                                style={{ width: `${uploadProgress}%` }}
                                            ></div>
                                        </div>
                                    )}

                                    {!uploading && uploadProgress === 100 && (
                                        <div className="w-full bg-blue-600 rounded-full h-2"></div>
                                    )}
                                </div>
                            </div>

                            {/* View Workspace Button */}
                            {uploadProgress === 100 && !uploading && (
                                <button
                                    onClick={handleViewWorkspace}
                                    className="px-6 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 transition-colors whitespace-nowrap"
                                >
                                    View Workspace
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
