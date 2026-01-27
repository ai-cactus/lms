"use client";

import { useRef, useState, useEffect } from "react";
import { CloudArrowUp, FilePdf, FileDoc, Trash, Eye, ArrowSquareOut, FolderPlus } from "@phosphor-icons/react";
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
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
                {selectedSource === 'uploaded' ? 'Upload Training Documents' : 'Upload Training Documents'}
            </h2>
            <p className="text-slate-500 mb-4 max-w-2xl mx-auto text-sm">
                {selectedSource === 'uploaded'
                    ? 'Upload your policy or compliance documents. We will analyze them and convert them into courses and quizzes automatically.'
                    : 'Upload your policy or compliance documents. We will analyze them and convert them into courses and quizzes automatically.'
                }
            </p>

            <div className="max-w-lg mx-auto">
                <div className="text-left mb-2">
                    <span className="text-slate-500 text-sm">Select file(s) from;</span>
                </div>

                <div className="mb-4 relative" ref={dropdownRef}>
                    <button
                        onClick={() => setShowDropdown(!showDropdown)}
                        className="w-full border border-gray-200 rounded-[12px] px-4 py-3 bg-white text-left flex justify-between items-center shadow-sm hover:border-gray-300 transition-colors"
                    >
                        <span className="text-slate-700 font-medium text-sm">
                            {selectedSource === 'computer' ? 'Browse Computer' : 'Uploaded documents'}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                            <button
                                onClick={(e) => handleSourceChange(e, 'computer')}
                                className={`w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors text-sm ${selectedSource === 'computer' ? 'bg-[#4E61F6]/10 text-[#4E61F6]' : 'text-slate-700'}`}
                            >
                                Browse Computer
                            </button>
                            <button
                                onClick={(e) => handleSourceChange(e, 'uploaded')}
                                className={`w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors border-t border-gray-100 text-sm ${selectedSource === 'uploaded' ? 'bg-[#4E61F6]/10 text-[#4E61F6]' : 'text-slate-700'}`}
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
                        className={`border-2 border-dashed border-gray-200 rounded-[20px] h-[300px] flex flex-col items-center justify-center bg-white transition-colors mb-4 ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}
                    >
                        <div className="mb-6 text-slate-500">
                            <FolderPlus size={64} weight="fill" />
                        </div>
                        <p className="font-medium text-slate-900 mb-2 text-sm">
                            Drop your files here or <span className="text-[#4758E0] underline font-semibold decoration-2 underline-offset-4">Click to upload</span>
                        </p>
                        <p className="text-xs text-slate-400">PDF, DOCX. You may upload multiple files.</p>
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
                    <div className="mb-4">
                        {loadingDocuments ? (
                            <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#4E61F6] mx-auto mb-2"></div>
                                <p className="text-slate-500 text-sm">Loading uploaded documents...</p>
                            </div>
                        ) : uploadedDocuments.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-slate-500 mb-2 text-sm">No uploaded documents found.</p>
                                <button
                                    onClick={(e) => handleSourceChange(e, 'computer')}
                                    className="text-[#4E61F6] hover:text-[#4E61F6]/80 font-medium text-sm"
                                >
                                    Upload new documents instead
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {uploadedDocuments.map((document) => (
                                    <div key={document.id} className="flex items-center justify-between p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="relative flex items-center">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedPolicyIds.includes(document.id)}
                                                    onChange={() => handleDocumentSelection(document.id)}
                                                    className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-gray-300 transition-all checked:border-[#4758E0] checked:bg-[#4758E0]"
                                                />
                                                <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100">
                                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </div>
                                            </div>

                                            {document.file_name.endsWith('.pdf') ? (
                                                <FilePdf size={32} weight="fill" className="text-[#F40F0F]" />
                                            ) : (
                                                <FileDoc size={32} weight="fill" className="text-[#4E61F6]" />
                                            )}

                                            <div className="flex flex-col items-start gap-1">
                                                <span className="text-sm font-semibold text-slate-900">{document.file_name}</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-0.5">
                                                        <div className="flex h-3 w-3 items-center justify-center rounded-full bg-[#4758E0]">
                                                            <svg width="8" height="6" viewBox="0 0 8 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </div>
                                                        <span className="text-[10px] font-medium text-[#4758E0]">Analyzed</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => handlePreviewDocument(document)}
                                            className="rounded-lg bg-[#4758E0] px-6 py-2 text-sm font-medium text-white hover:bg-[#3A4BC0] transition-colors"
                                        >
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
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <h4 className="font-medium text-red-800 mb-1 text-sm">File Validation Errors</h4>
                                <ul className="text-xs text-red-700 space-y-1">
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
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <h4 className="font-medium text-amber-800 mb-1 text-sm">File Validation Warnings</h4>
                                <ul className="text-xs text-amber-700 space-y-1">
                                    {validationWarnings.map((warning, index) => (
                                        <li key={index}>• {warning}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {isAnalyzing && (
                    <div className="mb-4 text-left">
                        <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium text-slate-700">Analyzing documents...</span>
                            <span className="text-slate-500">{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${uploadProgress}%` }}
                            ></div>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                            Please wait while we process your files. This may take a moment.
                        </p>
                    </div>
                )}

                {files.length > 0 && (
                    <div className="border-2 border-dashed border-gray-200 rounded-[20px] p-4 text-left">
                        <div className="divide-y divide-gray-100">
                            {files.map((file, idx) => (
                                <div key={idx} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                                    <div className="flex items-center gap-4">
                                        <div className="relative">
                                            {file.name.endsWith('.pdf') ? (
                                                <FilePdf size={24} className="text-red-500" weight="fill" />
                                            ) : (
                                                <FileDoc size={24} className="text-blue-500" weight="fill" />
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900">{file.name}</p>
                                            <p className="text-xs text-slate-500 mt-0.5">
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
                                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-[#4E61F6] text-white hover:bg-[#4E61F6]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Trash size={16} weight="fill" />
                                    </button>
                                </div>
                            ))}
                        </div>
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
