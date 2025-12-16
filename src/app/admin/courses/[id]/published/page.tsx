"use client";

import { useRouter, useParams } from "next/navigation";
import { CheckCircle, Users, LayoutDashboard } from "lucide-react";

export default function CoursePublishedPage() {
    const router = useRouter();
    const params = useParams();
    const courseId = params.id as string;

    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">
                    {/* Success Icon */}
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>

                    {/* Message */}
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Course Published Successfully
                    </h1>
                    <p className="text-slate-600 mb-8">
                        Assigned workers will now see this course on their dashboard.
                    </p>

                    {/* Actions */}
                    <div className="space-y-3">
                        <button
                            onClick={() => router.push("/admin/workers")}
                            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                        >
                            <Users className="w-5 h-5" />
                            Assign to Workers
                        </button>

                        <button
                            onClick={() => router.push("/admin/dashboard")}
                            className="w-full py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                        >
                            <LayoutDashboard className="w-5 h-5" />
                            Go to Dashboard
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
