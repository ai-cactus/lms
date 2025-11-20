"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Pie } from "react-chartjs-2";
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend,
    ChartOptions,
} from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

interface RoleCompliance {
    role: string;
    totalWorkers: number;
    compliant: number;
    nonCompliant: number;
    complianceRate: number;
}

export default function ComplianceByRoleChart() {
    const [data, setData] = useState<RoleCompliance[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRole, setSelectedRole] = useState<string | null>(null);
    const supabase = createClient();

    useEffect(() => {
        loadComplianceData();
    }, []);

    const loadComplianceData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) return;

            // Get all workers in organization
            const { data: workers, error: workersError } = await supabase
                .from("users")
                .select(`
          id,
          role,
          assignments:course_assignments(
            id,
            status,
            deadline
          )
        `)
                .eq("organization_id", userData.organization_id)
                .eq("role", "worker")
                .is("deactivated_at", null);

            if (workersError) throw workersError;

            // Group by role and calculate compliance
            const roleMap = new Map<string, { total: number; compliant: number }>();

            workers?.forEach((worker: any) => {
                const workerRole = worker.role || "Unknown";
                const assignments = Array.isArray(worker.assignments) ? worker.assignments : [];

                if (!roleMap.has(workerRole)) {
                    roleMap.set(workerRole, { total: 0, compliant: 0 });
                }

                const stats = roleMap.get(workerRole)!;
                stats.total++;

                // Check if worker is compliant (all assignments completed or no overdue)
                const hasOverdue = assignments.some(
                    (a: any) => a.status === "overdue" || (a.status === "not_started" && new Date(a.deadline) < new Date())
                );

                if (!hasOverdue && assignments.length > 0) {
                    stats.compliant++;
                }
            });

            // Convert to array
            const complianceData: RoleCompliance[] = Array.from(roleMap.entries()).map(
                ([role, stats]) => ({
                    role,
                    totalWorkers: stats.total,
                    compliant: stats.compliant,
                    nonCompliant: stats.total - stats.compliant,
                    complianceRate: stats.total > 0 ? (stats.compliant / stats.total) * 100 : 0,
                })
            );

            setData(complianceData.sort((a, b) => b.totalWorkers - a.totalWorkers));
            setLoading(false);
        } catch (error) {
            console.error("Error loading compliance data:", error);
            setLoading(false);
        }
    };

    const getChartData = () => {
        if (selectedRole) {
            const roleData = data.find((d) => d.role === selectedRole);
            if (!roleData) return null;

            return {
                labels: ["Compliant", "Non-Compliant"],
                datasets: [
                    {
                        data: [roleData.compliant, roleData.nonCompliant],
                        backgroundColor: ["#10b981", "#ef4444"],
                        borderColor: ["#ffffff", "#ffffff"],
                        borderWidth: 2,
                    },
                ],
            };
        }

        return {
            labels: data.map((d) => d.role),
            datasets: [
                {
                    label: "Compliance Rate",
                    data: data.map((d) => d.complianceRate),
                    backgroundColor: [
                        "#6366f1",
                        "#8b5cf6",
                        "#ec4899",
                        "#f59e0b",
                        "#10b981",
                        "#3b82f6",
                    ],
                    borderColor: "#ffffff",
                    borderWidth: 2,
                },
            ],
        };
    };

    const chartOptions: ChartOptions<"pie"> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: "bottom",
                labels: {
                    padding: 15,
                    font: {
                        size: 12,
                    },
                },
            },
            tooltip: {
                callbacks: {
                    label: (context) => {
                        if (selectedRole) {
                            return `${context.label}: ${context.parsed}`;
                        }
                        return `${context.label}: ${context.parsed.toFixed(1)}%`;
                    },
                },
            },
        },
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">
                    Compliance by Role
                </h3>
                <p className="text-slate-600">Loading...</p>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">
                    Compliance by Role
                </h3>
                <p className="text-slate-600">No worker data available</p>
            </div>
        );
    }

    const chartData = getChartData();

    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900">Compliance by Role</h3>
                {selectedRole && (
                    <button
                        onClick={() => setSelectedRole(null)}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                        ← Back to Overview
                    </button>
                )}
            </div>

            {/* Chart */}
            <div className="h-64 mb-6">
                {chartData && <Pie data={chartData} options={chartOptions} />}
            </div>

            {/* Role Details */}
            <div className="space-y-3">
                {data.map((roleData) => (
                    <div
                        key={roleData.role}
                        onClick={() => setSelectedRole(roleData.role)}
                        className="p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer transition-all"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-slate-900">{roleData.role}</span>
                            <span className="text-sm text-slate-600">
                                {roleData.totalWorkers} worker{roleData.totalWorkers !== 1 ? "s" : ""}
                            </span>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex-1">
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-green-600 transition-all duration-500"
                                        style={{ width: `${roleData.complianceRate}%` }}
                                    />
                                </div>
                            </div>
                            <span
                                className={`text-sm font-semibold ${roleData.complianceRate >= 80
                                        ? "text-green-600"
                                        : roleData.complianceRate >= 60
                                            ? "text-yellow-600"
                                            : "text-red-600"
                                    }`}
                            >
                                {roleData.complianceRate.toFixed(0)}%
                            </span>
                        </div>

                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                            <span>✓ {roleData.compliant} compliant</span>
                            <span>✗ {roleData.nonCompliant} non-compliant</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
