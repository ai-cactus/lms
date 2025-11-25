import { DocumentCategory } from "@/types/documents";
import { Folder } from "lucide-react";

interface CategoryListItemProps {
    category: DocumentCategory;
    onClick: () => void;
}

export default function CategoryListItem({ category, onClick }: CategoryListItemProps) {
    const getStatusBadge = () => {
        const count = category.documents_count || 0;

        if (count === 0) {
            return (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                    Pending Upload
                </span>
            );
        } else if (count < (category.min_documents || 1)) {
            return (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                    {count} document{count !== 1 ? 's' : ''} uploaded
                </span>
            );
        } else {
            return (
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    {count} document{count !== 1 ? 's' : ''} uploaded
                </span>
            );
        }
    };

    return (
        <div
            onClick={onClick}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
        >
            <div className="flex items-center gap-4">
                {/* Folder Icon */}
                <div className="w-12 h-12 bg-indigo-50 rounded-lg flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                    <Folder className="w-6 h-6 text-indigo-600" />
                </div>

                {/* Category Name */}
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {category.name}
                    </h3>
                    {category.description && (
                        <p className="text-sm text-slate-500 mt-0.5">{category.description}</p>
                    )}
                </div>
            </div>

            {/* Status Badge */}
            <div>
                {getStatusBadge()}
            </div>
        </div>
    );
}
