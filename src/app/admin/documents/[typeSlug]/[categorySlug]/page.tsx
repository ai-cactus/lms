"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DocumentCategory, PolicyDocument } from "@/types/documents";
import { ArrowLeft, CloudUpload, FileText, Trash2, CheckCircle, AlertCircle, File as FileIcon } from "lucide-react";
import Link from "next/link";

export default function CategoryDetailPage() {
    const [category, setCategory] = useState<DocumentCategory | null>(null);
    const [documents, setDocuments] = useState<PolicyDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();
    const params = useParams();
    const supabase = createClient();

    const typeSlug = params.typeSlug as string;
    const categorySlug = params.categorySlug as string;

    useEffect(() => {
        if (typeSlug && categorySlug) {
            loadData();
        }
    }, [typeSlug, categorySlug]);

    const loadData = async () => {
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
            const orgId = userData.organization_id;

            // 1. Fetch Category Details
            // We need to join with document_types to ensure it matches typeSlug
            const { data: catData, error: catError } = await supabase
                .from("document_categories")
                .select("*, document_types!inner(slug, name)")
                .eq("slug", categorySlug)
                .eq("document_types.slug", typeSlug)
                .single();

            if (catError || !catData) {
                console.error("Error loading category:", catError);
                router.push(`/admin/documents/${typeSlug}`);
                return;
            }

            setCategory(catData);

            // 2. Fetch Uploaded Documents for this Category
            const { data: docsData, error: docsError } = await supabase
                .from("policies")
                .select("*")
                .eq("organization_id", orgId)
                .eq("document_category_id", catData.id)
                .order("created_at", { ascending: false });

            if (docsError) throw docsError;

            setDocuments(docsData || []);
            setLoading(false);
        } catch (error) {
            console.error("Error loading data:", error);
            setLoading(false);
        }
    };

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

    const handleFilesSelect = async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        const validTypes = [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
            "application/msword", // .doc
        ];

        // Filter valid files
        const validFiles = fileArray.filter(file => {
            if (!validTypes.includes(file.type)) {
                return false;
            }
            if (file.size > 100 * 1024 * 1024) {
                return false;
            }
            return true;
        });

        if (validFiles.length === 0) {
            setError("Please upload valid PDF or DOCX files (max 100MB)");
            return;
        }

        setError("");

        // Upload files sequentially
        await uploadFiles(validFiles);
    };

    const uploadFiles = async (filesToUpload: File[]) => {
        if (!category) return;

        setUploading(true);
        setUploadProgress(0);
        setError("");

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) throw new Error("User data not found");

            const totalFiles = filesToUpload.length;

            for (let i = 0; i < totalFiles; i++) {
                const fileToUpload = filesToUpload[i];

                // Update progress based on overall completion
                const startProgress = (i / totalFiles) * 100;
                setUploadProgress(startProgress);

                // Upload to Storage
                const fileExt = fileToUpload.name.split('.').pop();
                const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
                const filePath = `${userData.organization_id}/${category.slug}/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from("policies")
                    .upload(filePath, fileToUpload);

                if (uploadError) throw uploadError;

                // Get Public URL
                const { data: { publicUrl } } = supabase.storage
                    .from("policies")
                    .getPublicUrl(filePath);

                // Insert into Database
                const { data: newDoc, error: dbError } = await supabase
                    .from("policies")
                    .insert({
                        organization_id: userData.organization_id,
                        document_category_id: category.id,
                        title: fileToUpload.name.replace(/\.[^/.]+$/, ""), // Remove extension
                        file_name: fileToUpload.name,
                        file_url: publicUrl,
                        file_size: fileToUpload.size,
                        mime_type: fileToUpload.type,
                        uploaded_by: user.id,
                        status: 'published'
                    })
                    .select()
                    .single();

                if (dbError) throw dbError;

                // Update documents list immediately
                setDocuments(prev => [newDoc, ...prev]);
            }

            setUploadProgress(100);

            setTimeout(() => {
                setUploading(false);
                setUploadProgress(0);
            }, 500);

        } catch (err: any) {
            console.error("Upload error:", JSON.stringify(err, null, 2));
            setError(err.message || "Failed to upload file");
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleDelete = async (docId: string, filePath: string) => {
        if (!confirm("Are you sure you want to delete this document?")) return;

        try {
            const { error: dbError } = await supabase
                .from("policies")
                .delete()
                .eq("id", docId);

            if (dbError) throw dbError;

            setDocuments(documents.filter(d => d.id !== docId));
        } catch (err: any) {
            console.error("Delete error:", err);
            alert("Failed to delete document");
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-slate-600">Loading...</div>
            </div>
        );
    }

    if (!category) return null;

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
                    <button
                        onClick={() => router.push(`/admin/documents/${typeSlug}`)}
                        className="flex items-center hover:text-slate-900 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Go Back
                    </button>
                    <span>/</span>
                    <span>CARF Plan</span>
                    <span>/</span>
                    <Link href={`/admin/documents/${typeSlug}`} className="hover:text-blue-600 transition-colors">
                        {(category as any).document_types?.name || "Document Type"}
                    </Link>
                </div>

                <h1 className="text-3xl font-bold text-slate-900 mb-2">{category.name}</h1>
                <p className="text-slate-500">
                    Documents and attachments that have been uploaded are displayed here
                </p>
            </div>

            {/* Upload Area */}
            <div className="bg-white rounded-xl border border-slate-200 p-8 mb-8">
                <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl py-12 px-8 text-center transition-colors ${dragActive ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50"
                        }`}
                >
                    <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CloudUpload className="w-8 h-8 text-blue-500" />
                    </div>

                    <h3 className="text-xl font-bold text-slate-900 mb-2">Drag & drop your files here</h3>
                    <p className="text-slate-500 mb-6">file type: PDF, DOCX (max. 100MB)</p>

                    <input
                        type="file"
                        accept=".pdf,.doc,.docx"
                        multiple
                        onChange={(e) => e.target.files && handleFilesSelect(e.target.files)}
                        className="hidden"
                        id="file-upload"
                        disabled={uploading}
                    />
                    <label
                        htmlFor="file-upload"
                        className={`inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer ${uploading ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                    >
                        {uploading ? "Uploading..." : "SELECT FILES"}
                    </label>

                    {uploading && (
                        <div className="w-full max-w-md mx-auto mt-6">
                            <div className="flex justify-between text-sm text-slate-600 mb-1">
                                <span>Uploading...</span>
                                <span>{Math.round(uploadProgress)}%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                <div
                                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${uploadProgress}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 flex items-center justify-center gap-2 text-red-600">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm">{error}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Uploaded Files List */}
            <div className="space-y-4">
                {documents.map((doc) => (
                    <div key={doc.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between group hover:shadow-sm transition-shadow">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center text-red-500">
                                {doc.mime_type?.includes('pdf') ? <FileText className="w-5 h-5" /> : <FileIcon className="w-5 h-5" />}
                            </div>
                            <div>
                                <h4 className="font-medium text-slate-900">{doc.title}</h4>
                                <p className="text-xs text-slate-500">
                                    {doc.file_size ? `${(doc.file_size / 1024 / 1024).toFixed(1)} MB • ` : ''}
                                    {new Date(doc.created_at).toLocaleDateString()}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium">
                                <CheckCircle className="w-3 h-3" />
                                Uploaded
                            </div>
                            <button
                                onClick={() => handleDelete(doc.id, doc.file_url)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete document"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}

                {documents.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                        No documents uploaded yet.
                    </div>
                )}
            </div>
        </div>
    );
}
