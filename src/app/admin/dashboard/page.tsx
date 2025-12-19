"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { CloudArrowUp, FilePdf, FileDoc, Trash, CheckCircle, XCircle, Clock } from "@phosphor-icons/react";
import { CloudUpload, Loader2, FileText, Trash2, HelpCircle } from "lucide-react";
import { validateDocumentForProcessing } from "@/lib/document-validation";

// Dynamically import DocumentPreview to avoid SSR issues with PDF.js
const DocumentPreview = dynamic(() => import("@/components/DocumentPreview"), {
    ssr: false,
});

interface FileUploadState {
    id: string; // Temporary ID for list management
    file: File;
    progress: number;
    status: 'pending' | 'uploading' | 'completed' | 'error';
    error?: string;
    policyId?: string;
    publicUrl?: string;
}

export default function AdminDashboard() {
    const [files, setFiles] = useState<FileUploadState[]>([]);
    const [dragActive, setDragActive] = useState(false);
    const [globalError, setGlobalError] = useState("");
    const [showPreview, setShowPreview] = useState(false);
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

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFilesSelect(e.dataTransfer.files);
        }
    }, []);

    const handleFilesSelect = async (selectedFiles: FileList | File[]) => {
        const fileArray = Array.from(selectedFiles);
        const validTypes = [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        ];

        // Filter and validate files using new validation system
        const validFiles: File[] = [];
        const invalidFiles: string[] = [];

        fileArray.forEach(file => {
            const validation = validateDocumentForProcessing(file);
            if (validation.isValid) {
                validFiles.push(file);
            } else {
                invalidFiles.push(`${file.name}: ${validation.error}`);
            }
        });

        if (validFiles.length === 0) {
            const errorMsg = invalidFiles.length > 0 
                ? `Invalid files:\n${invalidFiles.join('\n')}`
                : "Please upload valid PDF (max 25MB), DOCX (max 50MB), or TXT/MD (max 10MB) files";
            setGlobalError(errorMsg);
            return;
        }

        // Show warnings for invalid files but continue with valid ones
        if (invalidFiles.length > 0) {
            console.warn('Some files were rejected:', invalidFiles);
        }

        const newFiles: FileUploadState[] = validFiles.map(file => ({
            id: Math.random().toString(36).substring(7),
            file,
            progress: 0,
            status: 'pending'
        }));

        setFiles(prev => [...prev, ...newFiles]);
        setGlobalError("");

        // Trigger upload for the new files
        await uploadFiles(newFiles);
    };

    const updateFileState = (id: string, updates: Partial<FileUploadState>) => {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
    };

    const uploadFiles = async (filesToUpload: FileUploadState[]) => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) throw new Error("User data not found");

            // Process files sequentially to avoid overwhelming the client/network
            for (const fileState of filesToUpload) {
                await uploadSingleFile(fileState, userData.organization_id);
            }

        } catch (err: any) {
            console.error("Global upload error:", err);
            setGlobalError(err.message || "Failed to initiate upload");
        }
    };

    const uploadSingleFile = async (fileState: FileUploadState, orgId: string) => {
        updateFileState(fileState.id, { status: 'uploading', progress: 0 });

        try {
            // Simulate progress interval
            const progressInterval = setInterval(() => {
                setFiles(prev => {
                    const currentFile = prev.find(f => f.id === fileState.id);
                    if (currentFile && currentFile.status === 'uploading' && currentFile.progress < 90) {
                        return prev.map(f => f.id === fileState.id ? { ...f, progress: f.progress + 10 } : f);
                    }
                    return prev;
                });
            }, 200);

            const fileName = `${Date.now()}-${fileState.file.name}`;

            // Upload to Supabase
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from("policies")
                .upload(`${orgId}/${fileName}`, fileState.file);

            clearInterval(progressInterval);

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from("policies")
                .getPublicUrl(uploadData.path);

            // Create DB record
            const { data: policyData, error: policyError } = await supabase
                .from("policies")
                .insert({
                    organization_id: orgId,
                    title: fileState.file.name.replace(/\.(pdf|docx?)$/i, ""),
                    file_url: publicUrl,
                    file_name: fileState.file.name,
                    status: "draft",
                })
                .select()
                .single();

            if (policyError) throw policyError;

            updateFileState(fileState.id, {
                status: 'completed',
                progress: 100,
                policyId: policyData.id,
                publicUrl: publicUrl
            });

        } catch (err: any) {
            console.error(`Error uploading ${fileState.file.name}:`, err);
            updateFileState(fileState.id, {
                status: 'error',
                progress: 0,
                error: err.message || "Upload failed"
            });
        }
    };

    const handleRemoveFile = (id: string) => {
        setFiles(prev => prev.filter(f => f.id !== id));
    };

    const handleCancel = () => {
        router.push("/admin/documents");
    };

    const handlePreview = () => {
        setShowPreview(true);
    };

    const handleAnalyze = () => {
        setShowPreview(false);
        const completedFiles = files.filter(f => f.status === 'completed' && f.policyId);
        if (completedFiles.length > 0) {
            const policyIds = completedFiles.map(f => f.policyId).join(',');
            router.push(`/admin/courses/create?policyIds=${policyIds}`);
        }
    };

    // Get the last successfully uploaded file for preview
    const lastUploadedFile = [...files].reverse().find(f => f.status === 'completed');
    const isUploading = files.some(f => f.status === 'uploading');
    const hasCompletedFiles = files.some(f => f.status === 'completed');

    return (
        <div className="min-h-[calc(100vh-4rem)] bg-white flex items-center justify-center py-12 px-4">
            <div className="w-full max-w-5xl bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                {/* Main Content Area */}
                <div className="p-12 md:p-16">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <h1 className="text-4xl md:text-5xl font-bold text-[#4F46E5] mb-4 tracking-tight">
                            Upload Your Policy
                        </h1>
                        <p className="text-slate-500 text-lg">
                            Upload your documents here to get started! Accepted formats include PDF and DOCX.
                        </p>
                    </div>

                    {/* Upload Zone */}
                    <div className="max-w-3xl mx-auto">
                        {files.length === 0 ? (
                            <div
                                className="border-2 border-dashed rounded-3xl py-20 px-8 text-center border-slate-200 bg-white/20 cursor-not-allowed"
                            >
                                {/* Icon */}
                                <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6 opacity-50">
                                    <CloudUpload className="w-10 h-10 text-[#4F46E5]" strokeWidth={1.5} />
                                </div>

                                <h3 className="text-xl font-bold text-slate-900 mb-2 opacity-50">
                                    Drag & drop your files here
                                </h3>
                                <p className="text-slate-400 mb-8 opacity-50">
                                    PDF (max 25MB), DOCX (max 50MB), TXT/MD (max 10MB)
                                </p>

                                <div className="flex flex-col items-center gap-4">
                                    <span className="text-slate-400 text-sm opacity-50">or</span>

                                    <input
                                        type="file"
                                        accept=".pdf,.doc,.docx"
                                        multiple
                                        className="hidden"
                                        id="file-upload"
                                        disabled
                                    />
                                    <label
                                        htmlFor="file-upload"
                                        className="px-10 py-3.5 bg-[#4F46E5] text-white rounded-xl font-semibold text-sm tracking-wide shadow-lg shadow-indigo-200 opacity-50 cursor-not-allowed"
                                    >
                                        SELECT FILES
                                    </label>
                                </div>
                            </div>
                        ) : (
                            /* Uploaded Files List */
                            <div className="space-y-4">
                                {/* Add More Files Button */}
                                <div className="flex justify-end mb-4">
                                    <input
                                        type="file"
                                        accept=".pdf,.doc,.docx"
                                        multiple
                                        className="hidden"
                                        id="add-more-files"
                                        disabled
                                    />
                                    <label
                                        htmlFor="add-more-files"
                                        className="text-sm font-medium text-[#4F46E5] flex items-center gap-2 opacity-50 cursor-not-allowed"
                                    >
                                        <CloudUpload className="w-4 h-4" />
                                        Add more files
                                    </label>
                                </div>

                                {files.map((fileState) => (
                                    <div key={fileState.id} className="bg-white rounded-2xl p-6 border border-slate-100 relative group opacity-75">
                                        <div className="flex items-center gap-6">
                                            {/* Icon based on status */}
                                            <div className={`w-12 h-12 rounded-xl shadow-sm flex items-center justify-center flex-shrink-0 ${fileState.status === 'error' ? 'bg-red-50' : 'bg-white'
                                                }`}>
                                                {fileState.status === 'uploading' ? (
                                                    <Loader2 className="w-6 h-6 text-[#4F46E5] animate-spin" />
                                                ) : fileState.status === 'completed' ? (
                                                    <CheckCircle className="w-6 h-6 text-green-500" />
                                                ) : fileState.status === 'error' ? (
                                                    <XCircle className="w-6 h-6 text-red-500" />
                                                ) : (
                                                    <FileText className="w-6 h-6 text-[#4F46E5]" />
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h3 className="font-semibold text-slate-900 text-base truncate pr-4">
                                                        {fileState.file.name}
                                                    </h3>
                                                    <span className="text-slate-500 text-xs whitespace-nowrap">
                                                        {(fileState.file.size / 1024 / 1024).toFixed(1)} MB
                                                    </span>
                                                </div>

                                                {/* Progress Bar */}
                                                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full transition-all duration-300 ease-out ${fileState.status === 'error' ? 'bg-red-500' :
                                                            fileState.status === 'completed' ? 'bg-green-500' :
                                                                'bg-[#4F46E5]'
                                                            }`}
                                                        style={{ width: `${fileState.progress}%` }}
                                                    />
                                                </div>

                                                {fileState.error && (
                                                    <p className="text-red-500 text-xs mt-1">{fileState.error}</p>
                                                )}
                                            </div>

                                            {/* Delete Action */}
                                            <button
                                                disabled
                                                className="p-2 text-slate-400 cursor-not-allowed opacity-50"
                                                title="Remove file"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {globalError && (
                                    <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg text-center">
                                        {globalError}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-12 py-8 bg-white border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-400 cursor-default">
                        <HelpCircle className="w-5 h-5" />
                        <span className="text-sm font-medium">Help Center</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            disabled
                            className="px-8 py-3 text-slate-400 font-semibold bg-white rounded-xl cursor-not-allowed"
                        >
                            Cancel
                        </button>
                        <button
                            disabled
                            className="px-8 py-3 bg-slate-100 text-slate-400 rounded-xl font-semibold cursor-not-allowed opacity-50"
                        >
                            Preview
                        </button>
                    </div>
                </div>
            </div>

            {/* Document Preview Modal - Shows the last uploaded file for now */}

            {showPreview && lastUploadedFile && lastUploadedFile.publicUrl && (
                <DocumentPreview
                    fileUrl={lastUploadedFile.publicUrl}
                    fileName={lastUploadedFile.file.name}
                    onClose={() => setShowPreview(false)}
                    onAnalyze={handleAnalyze}
                />
            )}
        </div>
    );
}
