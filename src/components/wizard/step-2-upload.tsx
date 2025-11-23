"use client";

import { useRef } from "react";
import { CloudArrowUp, FilePdf, FileDoc, Trash } from "@phosphor-icons/react";

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

    const removeFile = (index: number) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        onFilesChange(newFiles);
    };

    return (
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Upload Training Documents</h2>
            <p className="text-slate-500 mb-12 max-w-2xl mx-auto text-base">
                Upload your policy or compliance documents. We will analyze them and convert them into courses and quizzes automatically.
            </p>

            <div className="text-left mb-2">
                <span className="text-slate-500 text-sm">Select file(s) from;</span>
            </div>

            <div className="mb-8">
                <button className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white text-left flex justify-between items-center shadow-sm">
                    <span className="text-slate-700 font-medium">Browse Computer</span>
                    <span className="text-slate-400">▼</span>
                </button>
            </div>

            <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-gray-200 rounded-xl p-16 bg-white hover:bg-slate-50 transition-colors cursor-pointer mb-8"
            >
                <div className="w-16 h-16 bg-gray-500 text-white rounded-lg flex items-center justify-center mx-auto mb-6">
                    <CloudArrowUp size={32} weight="fill" />
                </div>
                <p className="font-medium text-slate-700 mb-2">
                    Drop your files here or <span className="text-blue-600 underline">Click to upload</span>
                </p>
                <p className="text-sm text-slate-400">PDF, DOCX. You may upload multiple files.</p>
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
                <div className="text-left space-y-3 mb-8">
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
                                    <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                                </div>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeFile(idx);
                                }}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            >
                                <Trash size={20} weight="fill" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
