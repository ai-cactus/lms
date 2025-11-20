"use client";

import { useRef } from "react";
import { CloudArrowUp, FilePdf, FileDoc, Spinner } from "@phosphor-icons/react";

interface Step2UploadProps {
    files: File[];
    onFilesChange: (files: File[]) => void;
    onAnalyze: () => void;
    isAnalyzing: boolean;
}

export function Step2Upload({ files, onFilesChange, onAnalyze, isAnalyzing }: Step2UploadProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files);
            onFilesChange([...files, ...newFiles]);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const newFiles = Array.from(e.dataTransfer.files);
            onFilesChange([...files, ...newFiles]);
        }
    };

    return (
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Upload Training Documents</h2>
            <p className="text-slate-500 mb-8 max-w-lg mx-auto">
                Upload your policy or compliance documents. We will analyze them and convert them into courses and quizzes automatically.
            </p>

            <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer mb-8"
            >
                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CloudArrowUp size={32} />
                </div>
                <p className="font-medium text-slate-700">
                    Drag your files here or <span className="text-indigo-600 underline">Click to upload</span>
                </p>
                <p className="text-xs text-slate-400 mt-2">PDF, DOCX, PPTX. Max file size 50MB.</p>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md"
                />
            </div>

            {files.length > 0 && (
                <div className="text-left max-w-2xl mx-auto space-y-3 mb-8">
                    <h3 className="text-sm font-semibold text-slate-700 mb-2">Uploaded Documents</h3>

                    {files.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                            <div className="flex items-center gap-3">
                                {file.name.endsWith('.pdf') ? (
                                    <FilePdf size={24} className="text-red-500" />
                                ) : (
                                    <FileDoc size={24} className="text-blue-500" />
                                )}
                                <div>
                                    <p className="text-sm font-medium text-slate-800">{file.name}</p>
                                    <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <button
                onClick={onAnalyze}
                disabled={files.length === 0 || isAnalyzing}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-8 py-3 rounded-lg font-medium shadow-sm transition-all flex items-center justify-center gap-2 mx-auto"
            >
                {isAnalyzing ? (
                    <>
                        <Spinner size={20} className="animate-spin" />
                        Analyzing...
                    </>
                ) : (
                    "Analyze Documents"
                )}
            </button>
        </div>
    );
}
