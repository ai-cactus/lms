"use client";

import { useState } from "react";
import { X, Upload, Download, CheckCircle, AlertCircle } from "lucide-react";

interface ImportWorkersModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImportComplete: () => void;
    organizationId: string;
}

interface ImportResult {
    success: number;
    errors: { row: number; email: string; error: string }[];
}

export default function ImportWorkersModal({
    isOpen,
    onClose,
    onImportComplete,
    organizationId,
}: ImportWorkersModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.name.endsWith('.csv')) {
                setFile(droppedFile);
                setResult(null);
            } else {
                alert("Please upload a CSV file");
            }
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            if (selectedFile.name.endsWith('.csv')) {
                setFile(selectedFile);
                setResult(null);
            } else {
                alert("Please upload a CSV file");
            }
        }
    };

    const downloadTemplate = () => {
        const csvContent = "full_name,email,role\nJohn Doe,john@example.com,worker\nJane Smith,jane@example.com,worker";
        const blob = new Blob([csvContent], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "worker_import_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleImport = async () => {
        if (!file) return;

        setImporting(true);
        try {
            const text = await file.text();

            const { bulkImportWorkers } = await import("@/app/actions/staff");
            const importResult = await bulkImportWorkers(text, organizationId);

            setResult(importResult);

            if (importResult.success > 0) {
                onImportComplete();
            }
        } catch (error) {
            console.error("Import error:", error);
            alert("Failed to import workers. Please check your file format.");
        } finally {
            setImporting(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setResult(null);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
                    <h2 className="text-2xl font-bold text-slate-900">Import Workers</h2>
                    <button
                        onClick={handleClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {!result ? (
                        <>
                            <div className="space-y-2">
                                <h3 className="font-semibold text-slate-900">Upload CSV File</h3>
                                <p className="text-sm text-slate-600">
                                    Import multiple workers at once using a CSV file. Download the template below to get started.
                                </p>
                            </div>

                            <button
                                onClick={downloadTemplate}
                                className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium text-sm"
                            >
                                <Download className="w-4 h-4" />
                                Download CSV Template
                            </button>

                            <div
                                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${dragActive
                                        ? "border-indigo-500 bg-indigo-50"
                                        : "border-gray-300 hover:border-gray-400"
                                    }`}
                                onDragEnter={handleDrag}
                                onDragLeave={handleDrag}
                                onDragOver={handleDrag}
                                onDrop={handleDrop}
                            >
                                <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                                <p className="text-slate-700 font-medium mb-2">
                                    Drag and drop your CSV file here
                                </p>
                                <p className="text-sm text-slate-500 mb-4">or</p>
                                <label className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg font-medium text-slate-700 hover:bg-white cursor-pointer transition-colors">
                                    Browse Files
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={handleFileChange}
                                        className="hidden"
                                    />
                                </label>
                            </div>

                            {file && (
                                <div className="bg-white rounded-lg p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                                            <Upload className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <div>
                                            <p className="font-medium text-slate-900">{file.name}</p>
                                            <p className="text-sm text-slate-500">
                                                {(file.size / 1024).toFixed(2)} KB
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setFile(null)}
                                        className="text-slate-400 hover:text-slate-600"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                                <div>
                                    <p className="font-semibold text-green-900">
                                        Successfully imported {result.success} worker{result.success !== 1 ? 's' : ''}
                                    </p>
                                </div>
                            </div>

                            {result.errors.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-red-600 font-medium">
                                        <AlertCircle className="w-5 h-5" />
                                        <span>{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto space-y-2">
                                        {result.errors.map((error, idx) => (
                                            <div key={idx} className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                                                <p className="font-medium text-red-900">Row {error.row}: {error.email}</p>
                                                <p className="text-red-700">{error.error}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-200 flex items-center justify-end gap-3">
                    <button
                        onClick={handleClose}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-slate-700 font-medium hover:bg-white transition-colors"
                    >
                        {result ? "Close" : "Cancel"}
                    </button>
                    {!result && (
                        <button
                            onClick={handleImport}
                            disabled={!file || importing}
                            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {importing ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Importing...
                                </>
                            ) : (
                                "Import Workers"
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
