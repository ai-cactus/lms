import { useCallback } from "react";
import { CloudUpload } from "lucide-react";

interface DocumentUploadZoneProps {
    onFileSelect: (file: File) => void;
    uploading: boolean;
    dragActive: boolean;
    onDragStateChange: (active: boolean) => void;
}

export default function DocumentUploadZone({
    onFileSelect,
    uploading,
    dragActive,
    onDragStateChange,
}: DocumentUploadZoneProps) {
    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            onDragStateChange(true);
        } else if (e.type === "dragleave") {
            onDragStateChange(false);
        }
    }, [onDragStateChange]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onDragStateChange(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    }, [onFileSelect, onDragStateChange]);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
        }
    };

    return (
        <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${dragActive
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-gray-300 bg-white"
                }`}
        >
            {/* Cloud Icon */}
            <div className="flex justify-center mb-4">
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center">
                    <CloudUpload className="w-8 h-8 text-indigo-400" strokeWidth={1.5} />
                </div>
            </div>

            <h3 className="text-xl font-bold text-slate-900 mb-2">
                Drag & drop your files here
            </h3>
            <p className="text-sm text-slate-400 mb-1">
                file type: PDF, DOCX (max. 100MB)
            </p>
            <p className="text-sm text-slate-400 mb-4">or</p>

            {/* Select File Button */}
            <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleFileInputChange}
                className="hidden"
                id="file-upload-zone"
                disabled={uploading}
            />
            <label
                htmlFor="file-upload-zone"
                className={`inline-block px-8 py-3 rounded-lg font-semibold text-sm uppercase tracking-wide transition-colors ${uploading
                        ? "bg-indigo-300 text-white cursor-not-allowed"
                        : "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                    }`}
            >
                SELECT FILE
            </label>
        </div>
    );
}
