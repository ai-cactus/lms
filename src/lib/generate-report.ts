import { createClient } from "@/lib/supabase/server";

interface ReportData {
    organization: {
        name: string;
        program_type: string;
        license_number: string | null;
    };
    summary: {
        totalWorkers: number;
        activeWorkers: number;
        totalCourses: number;
        totalAssignments: number;
        completedAssignments: number;
        pendingConfirmations: number;
        overdueAssignments: number;
        complianceRate: number;
    };
    workersByRole: Array<{
        role: string;
        count: number;
        compliant: number;
        complianceRate: number;
    }>;
    courseCompletions: Array<{
        courseTitle: string;
        totalAssigned: number;
        completed: number;
        completionRate: number;
    }>;
    recentCompletions: Array<{
        workerName: string;
        courseTitle: string;
        completedAt: string;
        quizScore: number;
        confirmed: boolean;
    }>;
    overdueTrainings: Array<{
        workerName: string;
        courseTitle: string;
        deadline: string;
        daysOverdue: number;
    }>;
}

// Types for data processing - simplified to avoid complex type issues
interface WorkerData {
    id: string;
    full_name: string;
    role?: string;
    deactivated_at?: string | null;
    assignments?: AssignmentData[];
}

interface AssignmentData {
    id: string;
    status: string;
    deadline: string;
    course?: unknown;
    worker?: unknown;
}

interface CompletionData {
    id: string;
    completed_at: string;
    quiz_score: number;
    status?: string;
    course?: unknown;
    worker?: unknown;
    admin_confirmation?: AdminConfirmationData | AdminConfirmationData[];
}

interface AdminConfirmationData {
    confirmed: boolean;
}

export async function generateAccreditationReport(
    organizationId: string
): Promise<ReportData> {
    const supabase = await createClient();

    // Get organization details
    const { data: org } = await supabase
        .from("organizations")
        .select("name, program_type, license_number")
        .eq("id", organizationId)
        .single();

    if (!org) throw new Error("Organization not found");

    // Get all workers
    const { data: workers } = await supabase
        .from("users")
        .select(`
      id,
      full_name,
      role,
      deactivated_at,
      assignments:course_assignments(
        id,
        status,
        deadline,
        course:course_id(title)
      )
    `)
        .eq("organization_id", organizationId)
        .eq("role", "worker");

    const activeWorkers = workers?.filter((w) => !w.deactivated_at) || [];

    // Get all courses
    const { data: courses } = await supabase
        .from("courses")
        .select("id, title")
        .eq("organization_id", organizationId);

    // Get all assignments
    const { data: assignments } = await supabase
        .from("course_assignments")
        .select(`
      id,
      status,
      deadline,
      worker:worker_id(full_name),
      course:course_id(title)
    `)
        .in(
            "worker_id",
            activeWorkers.map((w) => w.id)
        );

    // Get completions
    const { data: completions } = await supabase
        .from("course_completions")
        .select(`
      id,
      completed_at,
      quiz_score,
      status,
      worker:worker_id(full_name),
      course:course_id(title),
      admin_confirmation:admin_confirmations(confirmed)
    `)
        .in(
            "worker_id",
            activeWorkers.map((w) => w.id)
        )
        .order("completed_at", { ascending: false })
        .limit(20);

    // Calculate summary stats
    const totalAssignments = assignments?.length || 0;
    const completedAssignments =
        assignments?.filter((a) => a.status === "completed").length || 0;
    const pendingConfirmations =
        completions?.filter((c) => c.status === "pending_confirmation").length || 0;
    const overdueAssignments =
        assignments?.filter((a) => {
            if (a.status === "completed") return false;
            return new Date(a.deadline) < new Date();
        }).length || 0;

    const complianceRate =
        totalAssignments > 0 ? (completedAssignments / totalAssignments) * 100 : 0;

    // Workers by role
    const roleMap = new Map<string, { count: number; compliant: number }>();
    activeWorkers.forEach((worker: WorkerData) => {
        const workerRole = worker.role || "Unknown";
        const assignments = Array.isArray(worker.assignments) ? worker.assignments : [];

        if (!roleMap.has(workerRole)) {
            roleMap.set(workerRole, { count: 0, compliant: 0 });
        }

        const stats = roleMap.get(workerRole)!;
        stats.count++;

        const hasOverdue = assignments.some(
            (a: AssignmentData) =>
                a.status === "overdue" ||
                (a.status === "not_started" && new Date(a.deadline) < new Date())
        );

        if (!hasOverdue && assignments.length > 0) {
            stats.compliant++;
        }
    });

    const workersByRole = Array.from(roleMap.entries()).map(([role, stats]) => ({
        role,
        count: stats.count,
        compliant: stats.compliant,
        complianceRate: stats.count > 0 ? (stats.compliant / stats.count) * 100 : 0,
    }));

    // Course completions
    const courseMap = new Map<string, { assigned: number; completed: number }>();
    assignments?.forEach((a: AssignmentData) => {
        const courseTitle = Array.isArray(a.course) ? (a.course as any)[0]?.title : (a.course as any)?.title;
        if (!courseTitle) return;

        if (!courseMap.has(courseTitle)) {
            courseMap.set(courseTitle, { assigned: 0, completed: 0 });
        }

        const stats = courseMap.get(courseTitle)!;
        stats.assigned++;
        if (a.status === "completed") {
            stats.completed++;
        }
    });

    const courseCompletions = Array.from(courseMap.entries()).map(
        ([courseTitle, stats]) => ({
            courseTitle,
            totalAssigned: stats.assigned,
            completed: stats.completed,
            completionRate: stats.assigned > 0 ? (stats.completed / stats.assigned) * 100 : 0,
        })
    );

    // Recent completions
    const recentCompletions =
        completions?.slice(0, 10).map((c: CompletionData) => ({
            workerName: Array.isArray(c.worker) ? (c.worker as any)[0]?.full_name : (c.worker as any)?.full_name,
            courseTitle: Array.isArray(c.course) ? (c.course as any)[0]?.title : (c.course as any)?.title,
            completedAt: c.completed_at as string,
            quizScore: c.quiz_score as number,
            confirmed: Array.isArray(c.admin_confirmation)
                ? (c.admin_confirmation as any)[0]?.confirmed
                : (c.admin_confirmation as any)?.confirmed,
        })) || [];

    // Overdue trainings
    const overdueTrainings =
        assignments
            ?.filter((a: AssignmentData) => {
                if (a.status === "completed") return false;
                return new Date(a.deadline) < new Date();
            })
            .map((a: AssignmentData) => ({
                workerName: Array.isArray(a.worker) ? (a.worker as any)[0]?.full_name : (a.worker as any)?.full_name,
                courseTitle: Array.isArray(a.course) ? (a.course as any)[0]?.title : (a.course as any)?.title,
                deadline: a.deadline,
                daysOverdue: Math.floor(
                    (Date.now() - new Date(a.deadline).getTime()) / (1000 * 60 * 60 * 24)
                ),
            }))
            .sort((a, b) => b.daysOverdue - a.daysOverdue)
            .slice(0, 20) || [];

    return {
        organization: org,
        summary: {
            totalWorkers: workers?.length || 0,
            activeWorkers: activeWorkers.length,
            totalCourses: courses?.length || 0,
            totalAssignments,
            completedAssignments,
            pendingConfirmations,
            overdueAssignments,
            complianceRate,
        },
        workersByRole,
        courseCompletions,
        recentCompletions,
        overdueTrainings,
    };
}

export function formatReportAsMarkdown(data: ReportData): string {
    const now = new Date();
    const formattedDate = now.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    return `# CARF Accreditation Training Report

**Organization:** ${data.organization.name}  
**Program Type:** ${data.organization.program_type}  
**License Number:** ${data.organization.license_number || "N/A"}  
**Report Generated:** ${formattedDate}

---

## Executive Summary

- **Total Workers:** ${data.summary.totalWorkers} (${data.summary.activeWorkers} active)
- **Total Courses:** ${data.summary.totalCourses}
- **Total Assignments:** ${data.summary.totalAssignments}
- **Completed Assignments:** ${data.summary.completedAssignments}
- **Overall Compliance Rate:** ${data.summary.complianceRate.toFixed(1)}%
- **Pending Confirmations:** ${data.summary.pendingConfirmations}
- **Overdue Assignments:** ${data.summary.overdueAssignments}

---

## Compliance by Role

| Role | Workers | Compliant | Compliance Rate |
|------|---------|-----------|-----------------|
${data.workersByRole
            .map(
                (r) =>
                    `| ${r.role} | ${r.count} | ${r.compliant} | ${r.complianceRate.toFixed(1)}% |`
            )
            .join("\n")}

---

## Course Completion Rates

| Course | Assigned | Completed | Completion Rate |
|--------|----------|-----------|-----------------|
${data.courseCompletions
            .map(
                (c) =>
                    `| ${c.courseTitle} | ${c.totalAssigned} | ${c.completed} | ${c.completionRate.toFixed(1)}% |`
            )
            .join("\n")}

---

## Recent Completions

| Worker | Course | Completed | Score | Confirmed |
|--------|--------|-----------|-------|-----------|
${data.recentCompletions
            .map(
                (c) =>
                    `| ${c.workerName} | ${c.courseTitle} | ${new Date(c.completedAt).toLocaleDateString()} | ${c.quizScore}% | ${c.confirmed ? "✓" : "Pending"} |`
            )
            .join("\n")}

---

## Overdue Trainings

${data.overdueTrainings.length === 0
            ? "_No overdue trainings_"
            : `
| Worker | Course | Deadline | Days Overdue |
|--------|--------|----------|--------------|
${data.overdueTrainings
                .map(
                    (o) =>
                        `| ${o.workerName} | ${o.courseTitle} | ${new Date(o.deadline).toLocaleDateString()} | ${o.daysOverdue} |`
                )
                .join("\n")}
`
        }

---

## CARF Compliance Statement

This report demonstrates compliance with CARF standards for staff training and development. All training records are maintained electronically and are available for review during accreditation surveys.

**Report ID:** ${Date.now()}  
**Generated By:** Theraptly LMS  
**Timestamp:** ${now.toISOString()}
`;
}
