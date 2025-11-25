import { DocumentType } from "@/types/documents";
import { Building2, Clipboard } from "lucide-react";

interface DocumentTypeCardProps {
    documentType: DocumentType;
    onClick: () => void;
}

export default function DocumentTypeCard({ documentType, onClick }: DocumentTypeCardProps) {
    const Icon = documentType.icon === "building" ? Building2 : Clipboard;

    return (
        <div
            onClick={onClick}
            className="group bg-white rounded-xl border border-slate-200 p-6 hover:shadow-lg hover:border-blue-200 transition-all duration-300 cursor-pointer flex flex-col h-full"
        >
            {/* Icon */}
            <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center mb-6 group-hover:bg-blue-600 group-hover:scale-110 transition-all duration-300">
                <Icon className="w-7 h-7 text-blue-600 group-hover:text-white transition-colors" strokeWidth={1.5} />
            </div>

            {/* Content */}
            <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">
                    {documentType.name}
                </h2>
                <p className="text-slate-500 text-sm leading-relaxed mb-6">
                    {documentType.description}
                </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-auto pt-6 border-t border-slate-50">
                {documentType.recent_uploaders && documentType.recent_uploaders.length > 0 ? (
                    <div className="flex -space-x-2">
                        {documentType.recent_uploaders.slice(0, 3).map((uploader, index) => (
                            <div
                                key={index}
                                className="w-7 h-7 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-[10px] font-bold text-white"
                            >
                                {uploader.charAt(0).toUpperCase()}
                            </div>
                        ))}
                    </div>
                ) : (
                    <span className="text-xs text-slate-400 font-medium">No uploads yet</span>
                )}

                <span className="text-sm font-medium text-blue-600 group-hover:translate-x-1 transition-transform">
                    View Documents →
                </span>
            </div>
        </div>
    );
}
