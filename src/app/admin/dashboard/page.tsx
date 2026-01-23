"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, XCircle } from "lucide-react";
import { CloudUpload, Loader2, FileText, Trash2, HelpCircle } from "lucide-react";
import { validateDocumentForProcessing } from "@/lib/document-validation";

// Dynamically import DocumentPreview to avoid SSR issues with PDF.js
const DocumentPreview = dynamic(() => import("@/components/DocumentPreview"), {
    ssr: false,
});

interface FileUploadState {
    id: string;
    file: File;
    progress: number;
    status: 'pending' | 'uploading' | 'completed' | 'error';
    error?: string;
    policyId?: string;
    publicUrl?: string;
}

export default function AdminDashboard() {
    const [files, setFiles] = useState<FileUploadState[]>([]);
    const [globalError, setGlobalError] = useState("");
    const [showPreview, setShowPreview] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    const handleFilesSelect = async (selectedFiles: FileList | File[]) => {
        const fileArray = Array.from(selectedFiles);

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

            for (const fileState of filesToUpload) {
                await uploadSingleFile(fileState, userData.organization_id);
            }

        } catch (err: unknown) {
            console.error("Global upload error:", err);
            setGlobalError((err as Error).message || "Failed to initiate upload");
        }
    };

    const uploadSingleFile = async (fileState: FileUploadState, orgId: string) => {
        updateFileState(fileState.id, { status: 'uploading', progress: 0 });

        try {
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

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from("policies")
                .upload(`${orgId}/${fileName}`, fileState.file);

            clearInterval(progressInterval);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from("policies")
                .getPublicUrl(uploadData.path);

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

        } catch (err: unknown) {
            console.error(`Error uploading ${fileState.file.name}:`, err);
            updateFileState(fileState.id, {
                status: 'error',
                progress: 0,
                error: (err as Error).message || "Upload failed"
            });
        }
    };

    const removeFile = (id: string) => {
        setFiles(prev => prev.filter(f => f.id !== id));
    };

    const handleAnalyze = () => {
        setShowPreview(false);
        const completedFiles = files.filter(f => f.status === 'completed' && f.policyId);
        if (completedFiles.length > 0) {
            const policyIds = completedFiles.map(f => f.policyId).join(',');
            router.push(`/admin/courses/create?policyIds=${policyIds}`);
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) {
            handleFilesSelect(e.dataTransfer.files);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const lastUploadedFile = [...files].reverse().find(f => f.status === 'completed');
    const hasCompletedFiles = files.some(f => f.status === 'completed');

    return (
        <div className="flex flex-col gap-8 max-w-[860px] mx-auto">
            {/* Page Header - Left Aligned */}
            <div>
                <h1 className="text-[40px] font-bold text-brand-primary leading-[48px] font-[family-name:var(--font-dm-sans)]">
                    Upload Your Policy
                </h1>
                <p className="text-lg text-black/70 mt-2.5 leading-6">
                    Upload your document here to get started! Accepted formats include PDF and DOCX.
                </p>
            </div>

            {/* Upload Zone */}
            {files.length === 0 ? (
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`w-full h-[530px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all ${isDragging
                        ? 'border-brand-primary bg-brand-primary/5'
                        : 'border-black/20 bg-white'
                        }`}
                >
                    {/* Cloud Icon */}
                    <div className="w-[104px] h-[104px] bg-[#EDEFFE] rounded-full flex items-center justify-center mb-6">
                        <CloudUpload className="w-[54px] h-[54px] text-brand-primary" strokeWidth={1.5} />
                    </div>

                    <h3 className="text-xl font-bold text-slate-900 mb-2">
                        Drag and drop file
                    </h3>
                    <p className="text-lg text-black/30 font-semibold text-center mb-6">
                        file type: PDF, DOCX (max. 100MB)<br />or
                    </p>

                    <input
                        type="file"
                        accept=".pdf,.doc,.docx"
                        multiple
                        className="hidden"
                        id="file-upload"
                        onChange={(e) => e.target.files && handleFilesSelect(e.target.files)}
                    />
                    <label
                        htmlFor="file-upload"
                        className="px-10 py-3.5 bg-[#4758E0] text-white rounded-xl font-semibold text-base cursor-pointer hover:bg-[#3d4dc7] transition-colors"
                    >
                        SELECT FILE
                    </label>
                </div>
            ) : (
                /* Uploaded Files List */
                <div className="space-y-4">
                    <div className="flex justify-end mb-2">
                        <input
                            type="file"
                            accept=".pdf,.doc,.docx"
                            multiple
                            className="hidden"
                            id="add-more-files"
                            onChange={(e) => e.target.files && handleFilesSelect(e.target.files)}
                        />
                        <label
                            htmlFor="add-more-files"
                            className="text-sm font-medium text-brand-primary flex items-center gap-2 cursor-pointer hover:underline"
                        >
                            <CloudUpload className="w-4 h-4" />
                            Add more files
                        </label>
                    </div>

                    {files.map((fileState) => (
                        <div key={fileState.id} className="bg-white rounded-xl p-5 border border-slate-200 relative group">
                            <div className="flex items-center gap-5">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${fileState.status === 'error' ? 'bg-red-50' : 'bg-indigo-50'
                                    }`}>
                                    {fileState.status === 'uploading' ? (
                                        <Loader2 className="w-6 h-6 text-brand-primary animate-spin" />
                                    ) : fileState.status === 'completed' ? (
                                        <CheckCircle className="w-6 h-6 text-green-500" />
                                    ) : fileState.status === 'error' ? (
                                        <XCircle className="w-6 h-6 text-red-500" />
                                    ) : (
                                        <FileText className="w-6 h-6 text-brand-primary" />
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

                                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-300 ease-out ${fileState.status === 'error' ? 'bg-red-500' :
                                                fileState.status === 'completed' ? 'bg-green-500' :
                                                    'bg-brand-primary'
                                                }`}
                                            style={{ width: `${fileState.progress}%` }}
                                        />
                                    </div>

                                    {fileState.error && (
                                        <p className="text-red-500 text-xs mt-1">{fileState.error}</p>
                                    )}
                                </div>

                                <button
                                    onClick={() => removeFile(fileState.id)}
                                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
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

            {/* Help Center Bar */}
            <div className="flex items-center justify-between h-14 rounded-xl">
                <div className="flex items-center gap-2.5 text-[#6D717F]">
                    <HelpCircle className="w-[27px] h-[27px]" />
                    <span className="text-base font-medium">Help Center</span>
                </div>

                <div className="flex items-center gap-5">
                    <button
                        onClick={() => setFiles([])}
                        disabled={files.length === 0}
                        className="px-8 py-4 text-slate-700 font-semibold border border-[#D2D5DB] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => setShowPreview(true)}
                        disabled={!hasCompletedFiles}
                        className="px-8 py-4 bg-[#E5E7EA] text-slate-700 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#d8dadd] transition-colors"
                    >
                        Preview
                    </button>
                </div>
            </div>

            {/* Document Preview Modal */}
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
