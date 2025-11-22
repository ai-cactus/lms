"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

interface PerformanceFiltersProps {
    roles: string[];
    courses: { id: string; title: string }[];
}

export default function PerformanceFilters({ roles, courses }: PerformanceFiltersProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [startDate, setStartDate] = useState(searchParams.get("startDate") || "");
    const [endDate, setEndDate] = useState(searchParams.get("endDate") || "");
    const [role, setRole] = useState(searchParams.get("role") || "");
    const [courseId, setCourseId] = useState(searchParams.get("courseId") || "");

    // Debounce filter updates
    useEffect(() => {
        const timer = setTimeout(() => {
            const params = new URLSearchParams();
            if (startDate) params.set("startDate", startDate);
            if (endDate) params.set("endDate", endDate);
            if (role) params.set("role", role);
            if (courseId) params.set("courseId", courseId);

            router.push(`?${params.toString()}`);
        }, 500);

        return () => clearTimeout(timer);
    }, [startDate, endDate, role, courseId, router]);

    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-wrap gap-4 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
                <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border min-w-[150px]"
                >
                    <option value="">All Roles</option>
                    {roles.map((r) => (
                        <option key={r} value={r}>{r}</option>
                    ))}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Course</label>
                <select
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border min-w-[200px]"
                >
                    <option value="">All Courses</option>
                    {courses.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                </select>
            </div>
            <button
                onClick={() => {
                    setStartDate("");
                    setEndDate("");
                    setRole("");
                    setCourseId("");
                }}
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
                Clear
            </button>
        </div>
    );
}
