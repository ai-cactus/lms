"use client";

import { AlertTriangle } from "lucide-react";

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    courseTitle: string;
    isDeleting?: boolean;
}

export default function DeleteConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    courseTitle,
    isDeleting = false,
}: DeleteConfirmationModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose}></div>

            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full">
                    {/* Icon */}
                    <div className="flex items-center justify-center pt-8">
                        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                            <AlertTriangle className="w-8 h-8 text-red-600" />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="px-6 py-6 text-center">
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">Delete Course</h2>
                        <p className="text-slate-600 mb-1">
                            Are you sure you want to delete <span className="font-semibold">{courseTitle}</span>?
                        </p>
                        <p className="text-sm text-red-600 font-medium">
                            This action cannot be undone.
                        </p>
                    </div>

                    {/* Footer */}
                    <div className="border-t border-gray-200 px-6 py-4 flex gap-3">
                        <button
                            onClick={onClose}
                            disabled={isDeleting}
                            className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            disabled={isDeleting}
                            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDeleting ? "Deleting..." : "Yes, Delete"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
