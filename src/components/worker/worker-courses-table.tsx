"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";

interface WorkerCourse {
    id: string;
    name: string;
    level: string;
    progress: number;
    deadline: string;
    status: 'not-started' | 'in-progress' | 'completed';
    grade?: number | null;
}

interface WorkerCoursesTableProps {
    courses: WorkerCourse[];
}

export function WorkerCoursesTable({ courses }: WorkerCoursesTableProps) {
    const router = useRouter();

    const handleViewCourse = (courseId: string) => {
        router.push(`/worker/courses/${courseId}/details`);
    };


    const getStatusColor = (progress: number) => {
        if (progress === 100) return 'bg-blue-500';
        if (progress > 0) return 'bg-blue-500';
        return 'bg-[#0D25FF]';
    };

    const getStatusIcon = (progress: number) => {
        if (progress === 100) return '✓';
        if (progress > 0) return '📘';
        return (
            <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M20.0695 2.63179e-07V6.02085V20.0695H14.0487V13.0485C14.0468 16.9264 10.9027 20.0695 7.02433 20.0695C3.1449 20.0695 0 16.9246 0 13.0452C0 9.16575 3.1449 6.02085 7.02433 6.02085C10.9027 6.02085 14.0468 9.16395 14.0487 13.0419V6.02085H7.02433H0V2.63179e-07L14.0487 0L20.0695 2.63179e-07Z" fill="white"/>
            </svg>
        );
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200">
            {/* Header */}
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">My Courses</h3>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search for courses..."
                                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Progress
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Grade
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Deadline
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Action
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {courses.map((course) => (
                            <tr key={course.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-medium mr-3 ${getStatusColor(course.progress)}`}>
                                            {getStatusIcon(course.progress)}
                                        </div>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">{course.name}</div>
                                            <div className="text-sm text-gray-500">{course.level}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="w-full bg-gray-200 rounded-full h-2 mr-3">
                                            <div
                                                className="bg-blue-500 h-2 rounded-full"
                                                style={{ width: `${course.progress}%` }}
                                            ></div>
                                        </div>
                                        <span className="text-sm font-medium text-gray-900">{course.progress}%</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {course.grade !== null && course.grade !== undefined ? `${course.grade}%` : '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {course.deadline}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleViewCourse(course.id)}
                                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                                        >
                                            View
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Courses Completed Section */}
            <div className="p-6 border-t border-gray-200">
                <h4 className="text-lg font-bold text-slate-900 mb-4">Courses Completed</h4>
                <div className="text-center py-8">
                    <p className="text-gray-600 mb-2">You have earned and uploaded <span className="font-semibold">0 badges</span></p>
                    <p className="text-sm text-gray-500 mb-4">
                        Currently, there are no badges uploaded to your profile. Begin your journey towards your certification goals.
                        Impress your peers with your accomplishments! Start preparing for your next certificate today!
                    </p>
                </div>
            </div>
        </div>
    );
}
