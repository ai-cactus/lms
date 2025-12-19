import { createClient } from "@/lib/supabase/server";
import { getDetailedOrgPerformance } from "@/app/actions/analytics";
import PerformanceFilters from "@/components/analytics/PerformanceFilters";
import ScoreDistributionChart from "@/components/analytics/ScoreDistributionChart";
import RolePerformanceTable from "@/components/analytics/RolePerformanceTable";
import { AlertTriangle, BookOpen, Users, TrendingUp, RefreshCw } from "lucide-react";

export default async function PerformanceOverviewPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return <div>Please log in to view analytics.</div>;
    }

    // Fetch User's Org
    const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

    const organizationId = userData?.organization_id;

    if (!organizationId) {
        return <div>No organization found for this user.</div>;
    }

    // Fetch Filters Data (Roles and Courses)
    const { data: rolesData } = await supabase
        .from('users')
        .select('job_title')
        .eq('organization_id', organizationId)
        .not('job_title', 'is', null);

    const roles = Array.from(new Set(rolesData?.map(r => r.job_title) || [])).sort();

    const { data: coursesData } = await supabase
        .from('courses')
        .select('id, title')
        .order('title');

    const courses = coursesData || [];

    // Parse Search Params
    const params = await searchParams;
    const filters = {
        startDate: params.startDate as string,
        endDate: params.endDate as string,
        role: params.role as string,
        courseId: params.courseId as string,
    };

    // Fetch Performance Data
    const { data, success, error } = await getDetailedOrgPerformance(organizationId, filters);

    if (!success || !data) {
        return (
            <div className="p-6">
                <div className="bg-red-50 text-red-700 p-4 rounded-lg">
                    Error loading performance data: {error}
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-900">Practice Performance Overview</h1>
                <span className="text-sm text-gray-500">Organization Analytics</span>
            </div>

            <PerformanceFilters roles={roles} courses={courses} />

            {/* 1. Score Distribution by Course */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="flex items-center gap-2 mb-6">
                    <TrendingUp className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Score Distribution by Course</h2>
                </div>
                {data.coursePerformance.length > 0 ? (
                    <ScoreDistributionChart data={data.coursePerformance} />
                ) : (
                    <div className="text-center py-10 text-gray-500">No course data available for the selected filters.</div>
                )}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 2. Objectives With Most Difficulty */}
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center gap-2 mb-6">
                        <AlertTriangle className="w-5 h-5 text-red-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Objectives With Most Difficulty</h2>
                    </div>
                    <div className="space-y-4">
                        {data.strugglingObjectives.length > 0 ? (
                            data.strugglingObjectives.map((obj, idx) => (
                                <div key={idx} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{obj.objectiveText}</p>
                                            <div className="flex items-center gap-1 mt-1">
                                                <BookOpen className="w-3 h-3 text-gray-400" />
                                                <span className="text-xs text-gray-500">{obj.courseTitle}</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-lg font-bold text-red-600">{obj.incorrectPercentage}%</span>
                                            <span className="block text-[10px] text-gray-400 uppercase">Incorrect</span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-10 text-gray-500">No struggling objectives identified.</div>
                        )}
                    </div>
                </section>

                {/* 4. Retraining Stats */}
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center gap-2 mb-6">
                        <RefreshCw className="w-5 h-5 text-blue-600" />
                        <h2 className="text-lg font-semibold text-gray-900">Retraining Stats</h2>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-blue-50 p-4 rounded-lg text-center">
                            <div className="text-2xl font-bold text-blue-700">{data.retrainingStats.workersInRetraining}</div>
                            <div className="text-xs text-blue-600 font-medium uppercase mt-1">Workers in Retraining</div>
                        </div>
                        <div className="bg-green-50 p-4 rounded-lg text-center">
                            <div className="text-2xl font-bold text-green-700">{data.retrainingStats.retrainingCompletionRate}%</div>
                            <div className="text-xs text-green-600 font-medium uppercase mt-1">Completion Rate</div>
                        </div>
                    </div>

                    <h3 className="text-sm font-medium text-gray-700 mb-3">Most Retrained Courses</h3>
                    <div className="space-y-3">
                        {data.retrainingStats.topRetrainedCourses.length > 0 ? (
                            data.retrainingStats.topRetrainedCourses.map((course, idx) => (
                                <div key={idx} className="flex justify-between items-center text-sm">
                                    <span className="text-gray-600 truncate max-w-[70%]">{course.title}</span>
                                    <span className="font-medium text-gray-900 bg-gray-100 px-2 py-0.5 rounded-full">{course.count} Retries</span>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-4 text-gray-500 text-sm">No retraining data available.</div>
                        )}
                    </div>
                </section>
            </div>

            {/* 3. Role/Category Performance */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="flex items-center gap-2 mb-6">
                    <Users className="w-5 h-5 text-purple-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Role / Category Performance</h2>
                </div>
                {data.rolePerformance.length > 0 ? (
                    <RolePerformanceTable data={data.rolePerformance} />
                ) : (
                    <div className="text-center py-10 text-gray-500">No role performance data available.</div>
                )}
            </section>
        </div>
    );
}
