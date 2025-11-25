import { PolicyDocument } from "@/types/documents";
import { FileText, Trash2 } from "lucide-react";

interface DocumentListItemProps {
    document: PolicyDocument;
    onDelete: (id: string) => void;
}

export default function DocumentListItem({ document, onDelete }: DocumentListItemProps) {
    const formatFileSize = (bytes?: number) => {
        if (!bytes) return "Unknown size";
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)}MB`;
    };

    const formatTimestamp = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 60) return `${diffMins} mins ago`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
        return date.toLocaleDateString();
    };

    const isPDF = document.mime_type === "application/pdf" || document.file_name.toLowerCase().endsWith('.pdf');

    return (
        <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between hover:shadow-sm transition-shadow">
            <div className="flex items-center gap-4 flex-1 min-w-0">
                {/* File Icon */}
                <div className={`w-12 h-12 ${isPDF ? 'bg-red-100' : 'bg-blue-100'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <div className="relative">
                        <FileText className={`w-6 h-6 ${isPDF ? 'text-red-600' : 'text-blue-600'}`} />
                        {isPDF && (
                            <span className="absolute -bottom-1 -right-1 text-xs font-bold text-red-600">
                                PDF
                            </span>
                        )}
                        {!isPDF && (
                            <span className="absolute -bottom-1 -right-1 text-xs font-bold text-blue-600">
                                DOC
                            </span>
                        )}
                    </div>
                </div>

                {/* Document Info */}
                <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-slate-900 truncate">
                        {document.file_name}
                    </h4>
                    <p className="text-sm text-slate-500">
                        {formatTimestamp(document.created_at)} • {formatFileSize(document.file_size)}
                    </p>
                </div>

                {/* Uploader Avatar */}
                {document.uploader && (
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-semibold text-white">
                            {document.uploader.full_name?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-xs font-semibold text-white">
                            {document.uploader.full_name?.split(' ')[1]?.charAt(0).toUpperCase() || 'S'}
                        </div>
                    </div>
                )}
            </div>

            {/* Delete Button */}
            <button
                onClick={() => onDelete(document.id)}
                className="ml-4 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete document"
            >
                <Trash2 className="w-5 h-5" />
            </button>
        </div>
    );
}
