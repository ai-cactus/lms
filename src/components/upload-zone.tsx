"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
    onFilesSelected: (files: File[]) => void;
}

export function UploadZone({ onFilesSelected }: UploadZoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [files, setFiles] = useState<File[]>([]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);
            const droppedFiles = Array.from(e.dataTransfer.files);
            // Filter for text-based files if needed, for now accept all but maybe limit count
            const validFiles = droppedFiles.slice(0, 5); // Limit to 5
            setFiles((prev) => [...prev, ...validFiles]);
            onFilesSelected(validFiles);
        },
        [onFilesSelected]
    );

    const handleFileInput = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            if (e.target.files) {
                const selectedFiles = Array.from(e.target.files);
                const validFiles = selectedFiles.slice(0, 5);
                setFiles((prev) => [...prev, ...validFiles]);
                onFilesSelected(validFiles);
            }
        },
        [onFilesSelected]
    );

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    return (
        <div className="w-full max-w-2xl mx-auto">
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    "relative group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-300 ease-out p-10 text-center overflow-hidden",
                    isDragging
                        ? "border-primary bg-primary/10 scale-[1.02]"
                        : "border-white/10 hover:border-white/20 hover:bg-white/5"
                )}
            >
                <input
                    type="file"
                    multiple
                    onChange={handleFileInput}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />

                <div className="relative z-0 flex flex-col items-center justify-center gap-4">
                    <div className={cn(
                        "p-4 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 backdrop-blur-md shadow-xl transition-transform duration-500",
                        isDragging ? "scale-110 rotate-12" : "group-hover:scale-105"
                    )}>
                        <Upload className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
                            Upload Documents
                        </h3>
                        <p className="text-sm text-zinc-400 mt-2">
                            Drag & drop up to 5 files here, or click to select
                        </p>
                    </div>
                </div>

                {/* Background Glow Effect */}
                <div className="absolute inset-0 -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] bg-primary/20 blur-[100px] rounded-full" />
                </div>
            </div>

            {/* File List */}
            <AnimatePresence>
                {files.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="mt-6 space-y-3"
                    >
                        {files.map((file, index) => (
                            <motion.div
                                key={`${file.name}-${index}`}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ delay: index * 0.1 }}
                                className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm"
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="p-2 rounded-lg bg-primary/10">
                                        <FileText className="w-4 h-4 text-primary" />
                                    </div>
                                    <span className="text-sm font-medium truncate text-zinc-200">
                                        {file.name}
                                    </span>
                                    <span className="text-xs text-zinc-500">
                                        {(file.size / 1024).toFixed(1)} KB
                                    </span>
                                </div>
                                <button
                                    onClick={() => removeFile(index)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </motion.div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
