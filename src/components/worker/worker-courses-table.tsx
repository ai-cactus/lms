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
                <path fillRule="evenodd" clipRule="evenodd" d="M20.0695 2.63179e-07V6.02085V20.0695H14.0487V13.0485C14.0468 16.9264 10.9027 20.0695 7.02433 20.0695C3.1449 20.0695 0 16.9246 0 13.0452C0 9.16575 3.1449 6.02085 7.02433 6.02085C10.9027 6.02085 14.0468 9.16395 14.0487 13.0419V6.02085H7.02433H0V2.63179e-07L14.0487 0L20.0695 2.63179e-07Z" fill="white" />
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
                {courses.filter(c => c.status === 'completed' || c.progress === 100).length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {courses
                            .filter(c => c.status === 'completed' || c.progress === 100)
                            .map(course => (
                                <div key={course.id} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col items-center text-center shadow-sm hover:shadow-md transition-shadow">
                                    <div className="w-16 h-16 bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-full flex items-center justify-center mb-3 text-yellow-600">
                                        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M16 2L4 7V14C4 22 9 28 16 30C23 28 28 22 28 14V7L16 2Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M10 14L14 18L22 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                    <h5 className="font-semibold text-slate-900 text-sm mb-1 line-clamp-2">{course.name}</h5>
                                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{course.level}</span>
                                    <p className="text-xs text-green-600 font-medium mt-2">Earned on {course.deadline}</p>
                                </div>
                            ))}
                    </div>
                ) : (
                    <div className="text-center py-8">
                        <p className="text-gray-600 mb-2">You have earned <span className="font-semibold">0 badges</span></p>
                        <p className="text-sm text-gray-500 mb-4">
                            Currently, there are no badges awarded to your profile. Begin your journey towards your certification goals.
                            Impress your peers with your accomplishments! Start preparing for your next certificate today!
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
