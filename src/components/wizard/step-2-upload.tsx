"use client";

import { useRef, useState, useEffect } from "react";
import { CloudArrowUp, FilePdf, FileDoc, Trash, Eye, ArrowSquareOut } from "@phosphor-icons/react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { validateDocumentForProcessing } from "@/lib/document-validation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface UploadedDocument {
    id: string;
    title: string;
    file_name: string;
    file_url: string;
    created_at: string;
    file_size?: number;
}

interface Step2UploadProps {
    files: File[];
    onFilesChange: (files: File[]) => void;
    onAnalyze: () => void;
    isAnalyzing: boolean;
    uploadProgress?: number;
    selectedPolicyIds?: string[];
    onSelectedPolicyIdsChange?: (ids: string[]) => void;
}

export function Step2Upload({
    files,
    onFilesChange,
    onAnalyze,
    isAnalyzing,
    uploadProgress = 0,
    selectedPolicyIds = [],
    onSelectedPolicyIdsChange
}: Step2UploadProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedSource, setSelectedSource] = useState<'computer' | 'uploaded'>('computer');
    const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
    // Removed local selectedDocuments state in favor of selectedPolicyIds prop
    const [loadingDocuments, setLoadingDocuments] = useState(false);
    const [previewDocument, setPreviewDocument] = useState<UploadedDocument | null>(null);
    const [docPreviewHtml, setDocPreviewHtml] = useState<string | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const supabase = createClient();
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (selectedSource === 'uploaded') {
            loadUploadedDocuments();
        }
    }, [selectedSource]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (showDropdown && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showDropdown]);

    const loadUploadedDocuments = async () => {
        setLoadingDocuments(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData?.organization_id) return;

            const { data: documents } = await supabase
                .from("policies")
                .select("id, title, file_name, file_url, created_at, file_size")
                .eq("organization_id", userData.organization_id)
                .eq("status", "published")
                .order("created_at", { ascending: false });

            setUploadedDocuments(documents || []);
        } catch (error) {
            console.error("Error loading uploaded documents:", error);
        } finally {
            setLoadingDocuments(false);
        }
    };

    const handleDocumentSelection = (documentId: string) => {
        if (!onSelectedPolicyIdsChange) return;

        const newSelection = selectedPolicyIds.includes(documentId)
            ? selectedPolicyIds.filter(id => id !== documentId)
            : [...selectedPolicyIds, documentId];

        onSelectedPolicyIdsChange(newSelection);
    };

    const handleSourceChange = (event: React.MouseEvent, source: 'computer' | 'uploaded') => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedSource(source);
        setShowDropdown(false);
        if (source === 'computer') {
            onSelectedPolicyIdsChange?.([]);
        }
    };





    const handlePreviewDocument = async (document: UploadedDocument) => {
        setPreviewDocument(document);
        setDocPreviewHtml(null);

        // For DOCX files, fetch and convert to HTML
        const isDocx = document.file_name.toLowerCase().endsWith('.docx') ||
            document.file_name.toLowerCase().endsWith('.doc');

        if (isDocx) {
            setLoadingPreview(true);
            try {
                const response = await fetch('/api/document/convert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileUrl: document.file_url })
                });

                if (response.ok) {
                    const data = await response.json();
                    setDocPreviewHtml(data.html);
                } else {
                    console.error('Failed to convert document');
                }
            } catch (error) {
                console.error('Error converting document:', error);
            } finally {
                setLoadingPreview(false);
            }
        }
    };

    const closePreview = () => {
        setPreviewDocument(null);
        setDocPreviewHtml(null);
    };

    const validateAndAddFiles = (newFiles: File[]) => {
        const validFiles: File[] = [];
        const errors: string[] = [];
        const warnings: string[] = [];

        newFiles.forEach(file => {
            const validation = validateDocumentForProcessing(file);
            if (validation.isValid) {
                validFiles.push(file);
                if (validation.warning) {
                    warnings.push(`${file.name}: ${validation.warning}`);
                }
            } else {
                errors.push(`${file.name}: ${validation.error}`);
            }
        });

        setValidationErrors(errors);
        setValidationWarnings(warnings);

        if (validFiles.length > 0) {
            onFilesChange([...files, ...validFiles]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files);
            validateAndAddFiles(newFiles);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const newFiles = Array.from(e.dataTransfer.files);
            validateAndAddFiles(newFiles);
        }
    };

    const removeFile = (index: number) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        onFilesChange(newFiles);
    };

    return (
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
                {selectedSource === 'uploaded' ? 'Upload Training Documents' : 'Upload Training Documents'}
            </h2>
            <p className="text-slate-500 mb-8 max-w-2xl mx-auto text-base">
                {selectedSource === 'uploaded'
                    ? 'Upload your policy or compliance documents. We will analyze them and convert them into courses and quizzes automatically.'
                    : 'Upload your policy or compliance documents. We will analyze them and convert them into courses and quizzes automatically.'
                }
            </p>

            <div className="max-w-xl mx-auto">
                <div className="text-left mb-2">
                    <span className="text-slate-500 text-sm">Select file(s) from;</span>
                </div>

                <div className="mb-6 relative" ref={dropdownRef}>
                    <button
                        onClick={() => setShowDropdown(!showDropdown)}
                        className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white text-left flex justify-between items-center shadow-sm hover:border-gray-300 transition-colors"
                    >
                        <span className="text-slate-700 font-medium">
                            {selectedSource === 'computer' ? 'Browse Computer' : 'Uploaded documents'}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                            <button
                                onClick={(e) => handleSourceChange(e, 'computer')}
                                className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${selectedSource === 'computer' ? 'bg-[#4E61F6]/10 text-[#4E61F6]' : 'text-slate-700'}`}
                            >
                                Browse Computer
                            </button>
                            <button
                                onClick={(e) => handleSourceChange(e, 'uploaded')}
                                className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-t border-gray-100 ${selectedSource === 'uploaded' ? 'bg-[#4E61F6]/10 text-[#4E61F6]' : 'text-slate-700'}`}
                            >
                                Uploaded documents
                            </button>
                        </div>
                    )}
                </div>

                {selectedSource === 'computer' ? (
                    <div
                        onClick={() => !isAnalyzing && fileInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={!isAnalyzing ? handleDrop : (e) => e.preventDefault()}
                        className={`border-2 border-dashed border-gray-200 rounded-xl p-8 bg-white transition-colors mb-6 ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white cursor-pointer'}`}
                    >
                        <div className="w-16 h-16 bg-gray-500 text-white rounded-lg flex items-center justify-center mx-auto mb-6">
                            <CloudArrowUp size={32} weight="fill" />
                        </div>
                        <p className="font-medium text-slate-700 mb-2">
                            Drop your files here or <span className="text-[#4E61F6] underline">Click to upload</span>
                        </p>
                        <p className="text-sm text-slate-400">PDF (max 25MB), DOCX (max 50MB), TXT/MD (max 10MB). You may upload multiple files.</p>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden"
                            multiple
                            accept=".pdf,.doc,.docx,.txt,.md"
                            disabled={isAnalyzing}
                        />
                    </div>
                ) : (
                    <div className="mb-6">
                        {loadingDocuments ? (
                            <div className="text-center py-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4E61F6] mx-auto mb-4"></div>
                                <p className="text-slate-500">Loading uploaded documents...</p>
                            </div>
                        ) : uploadedDocuments.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-slate-500 mb-4">No uploaded documents found.</p>
                                <button
                                    onClick={(e) => handleSourceChange(e, 'computer')}
                                    className="text-[#4E61F6] hover:text-[#4E61F6]/80 font-medium"
                                >
                                    Upload new documents instead
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {uploadedDocuments.map((document) => (
                                    <div key={document.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg bg-white hover:border-gray-300 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedPolicyIds.includes(document.id)}
                                                onChange={() => handleDocumentSelection(document.id)}
                                                className="w-4 h-4 text-[#4E61F6] border-gray-300 rounded focus:ring-[#4E61F6]"
                                            />
                                            <div className="flex items-center gap-3">
                                                {document.file_name.endsWith('.pdf') ? (
                                                    <FilePdf size={24} className="text-red-500" weight="fill" />
                                                ) : (
                                                    <FileDoc size={24} className="text-blue-500" weight="fill" />
                                                )}
                                                <div>
                                                    <Link
                                                        href="/admin/documents"
                                                        className="font-medium text-slate-900 hover:text-[#4E61F6] hover:underline flex items-center gap-1"
                                                    >
                                                        {document.file_name}
                                                        <ArrowSquareOut size={14} className="text-slate-400" />
                                                    </Link>
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded">Analyzed</span>
                                                        {document.file_size && (
                                                            <span>{(document.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handlePreviewDocument(document)}
                                            className="px-4 py-2 bg-[#4E61F6] text-white rounded-lg font-medium hover:bg-[#4E61F6]/90 transition-colors flex items-center gap-2"
                                        >
                                            <Eye size={16} />
                                            Preview
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Validation Errors */}
                {validationErrors.length > 0 && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <h4 className="font-medium text-red-800 mb-2">File Validation Errors</h4>
                                <ul className="text-sm text-red-700 space-y-1">
                                    {validationErrors.map((error, index) => (
                                        <li key={index}>• {error}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* Validation Warnings */}
                {validationWarnings.length > 0 && (
                    <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <h4 className="font-medium text-amber-800 mb-2">File Validation Warnings</h4>
                                <ul className="text-sm text-amber-700 space-y-1">
                                    {validationWarnings.map((warning, index) => (
                                        <li key={index}>• {warning}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {isAnalyzing && (
                    <div className="mb-6 text-left">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="font-medium text-slate-700">Analyzing documents...</span>
                            <span className="text-slate-500">{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div
                                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${uploadProgress}%` }}
                            ></div>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                            Please wait while we process your files. This may take a moment.
                        </p>
                    </div>
                )}

                {files.length > 0 && (
                    <div className="text-left space-y-3 mb-6">
                        {files.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                                <div className="flex items-center gap-4">
                                    {file.name.endsWith('.pdf') ? (
                                        <FilePdf size={32} className="text-red-500" weight="fill" />
                                    ) : (
                                        <FileDoc size={32} className="text-blue-500" weight="fill" />
                                    )}
                                    <div>
                                        <p className="text-sm font-bold text-slate-900">{file.name}</p>
                                        <p className="text-xs text-slate-500">
                                            {file.size < 1024 * 1024
                                                ? `${(file.size / 1024).toFixed(1)} KB`
                                                : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isAnalyzing) removeFile(idx);
                                    }}
                                    disabled={isAnalyzing}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-[#4E61F6] text-white hover:bg-[#4E61F6]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Trash size={20} weight="fill" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Document Preview Modal */}
            {previewDocument && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
                        <div className="flex items-center justify-between p-6 border-b border-gray-200">
                            <h3 className="text-lg font-semibold text-slate-900">Document Preview</h3>
                            <button
                                onClick={closePreview}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-6">
                            <div className="flex items-center gap-4 mb-4">
                                {previewDocument.file_name.endsWith('.pdf') ? (
                                    <FilePdf size={32} className="text-red-500" weight="fill" />
                                ) : (
                                    <FileDoc size={32} className="text-blue-500" weight="fill" />
                                )}
                                <div>
                                    <h4 className="font-semibold text-slate-900">{previewDocument.file_name}</h4>
                                    <p className="text-sm text-slate-500">
                                        {previewDocument.file_size && `${(previewDocument.file_size / (1024 * 1024)).toFixed(1)} MB`}
                                    </p>
                                </div>
                            </div>

                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                                {previewDocument.file_name.toLowerCase().endsWith('.pdf') ? (
                                    <iframe
                                        src={previewDocument.file_url}
                                        className="w-full h-96"
                                        title={`Preview of ${previewDocument.file_name}`}
                                    />
                                ) : loadingPreview ? (
                                    <div className="p-8 text-center">
                                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4E61F6] mx-auto mb-4"></div>
                                        <p className="text-slate-600">Loading document preview...</p>
                                    </div>
                                ) : docPreviewHtml ? (
                                    <div
                                        className="p-6 max-h-96 overflow-y-auto prose prose-sm max-w-none"
                                        dangerouslySetInnerHTML={{ __html: docPreviewHtml }}
                                    />
                                ) : (
                                    <div className="p-8 text-center">
                                        <FileDoc size={64} className="text-blue-500 mx-auto mb-4" weight="fill" />
                                        <p className="text-slate-600 mb-4">Preview not available for this file type.</p>
                                        <a
                                            href={previewDocument.file_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-[#4E61F6] text-white rounded-lg font-medium hover:bg-[#4E61F6]/90 transition-colors"
                                        >
                                            <Eye size={16} />
                                            Open in New Tab
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
