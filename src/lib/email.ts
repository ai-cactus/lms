import { Resend } from "resend";
import { render } from "@react-email/render";
import WorkerWelcomeEmail from "@/emails/worker-welcome";
import TrainingReminderEmail from "@/emails/training-reminder";
import WeeklySnapshotEmail from "@/emails/weekly-snapshot";
import MonthlyOverviewEmail from "@/emails/monthly-overview";

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendWorkerWelcomeParams {
    to: string;
    workerName: string;
    organizationName: string;
    tempPassword: string;
    assignedCourses: string[];
}

interface SendTrainingReminderParams {
    to: string;
    workerName: string;
    courseTitle: string;
    deadline: Date;
}

interface SendWeeklySnapshotParams {
    to: string[];
    organizationName: string;
    overdueCount: number;
    pendingConfirmations: number;
    complianceRate: number;
    roleCompliance: { role: string; rate: number }[];
    dashboardUrl: string;
}

interface SendMonthlyOverviewParams {
    to: string[];
    organizationName: string;
    month: string;
    topCourses: { title: string; completionRate: number }[];
    strugglingObjectives: { text: string; incorrectRate: number }[];
    retrainingStats: { workersInRetraining: number; completionRate: number };
    reportUrl: string;
    attachments?: { filename: string; content: Buffer }[];
}

export async function sendWorkerWelcomeEmail(params: SendWorkerWelcomeParams) {
    try {
        const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login`;

        const emailHtml = await render(
            WorkerWelcomeEmail({
                workerName: params.workerName,
                organizationName: params.organizationName,
                loginUrl,
                tempPassword: params.tempPassword,
                assignedCourses: params.assignedCourses,
            })
        );

        const { data, error } = await resend.emails.send({
            from: "Theraptly Training <noreply@theraptly.com>",
            to: params.to,
            subject: `Welcome to ${params.organizationName} Training Portal`,
            html: emailHtml,
        });

        if (error) {
            console.error("Error sending welcome email:", error);
            throw error;
        }

        return { success: true, data };
    } catch (error) {
        console.error("Failed to send welcome email:", error);
        return { success: false, error };
    }
}

export async function sendTrainingReminderEmail(params: SendTrainingReminderParams) {
    try {
        const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login`;
        const now = new Date();
        const daysRemaining = Math.ceil(
            (params.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        const emailHtml = await render(
            TrainingReminderEmail({
                workerName: params.workerName,
                courseTitle: params.courseTitle,
                deadline: params.deadline.toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                }),
                daysRemaining,
                loginUrl,
            })
        );

        const isOverdue = daysRemaining < 0;
        const subject = isOverdue
            ? `⚠️ Overdue: ${params.courseTitle}`
            : `Reminder: ${params.courseTitle} due in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`;

        const { data, error } = await resend.emails.send({
            from: "Theraptly Training <noreply@theraptly.com>",
            to: params.to,
            subject,
            html: emailHtml,
        });

        if (error) {
            console.error("Error sending reminder email:", error);
            throw error;
        }

        return { success: true, data };
    } catch (error) {
        console.error("Failed to send reminder email:", error);
        return { success: false, error };
    }
}

export async function sendBulkTrainingReminders(
    reminders: SendTrainingReminderParams[]
) {
    const results = await Promise.allSettled(
        reminders.map((reminder) => sendTrainingReminderEmail(reminder))
    );

    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return {
        total: reminders.length,
        successful,
        failed,
        results,
    };
}

export async function sendWeeklyComplianceEmail(params: SendWeeklySnapshotParams) {
    try {
        const emailHtml = await render(
            WeeklySnapshotEmail({
                organizationName: params.organizationName,
                overdueCount: params.overdueCount,
                pendingConfirmations: params.pendingConfirmations,
                complianceRate: params.complianceRate,
                roleCompliance: params.roleCompliance,
                dashboardUrl: params.dashboardUrl,
            })
        );

        const { data, error } = await resend.emails.send({
            from: "Theraptly Training <noreply@theraptly.com>",
            to: params.to,
            subject: `Weekly Compliance Snapshot – ${params.organizationName}`,
            html: emailHtml,
        });

        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error("Failed to send weekly report:", error);
        return { success: false, error };
    }
}

export async function sendMonthlyPerformanceEmail(params: SendMonthlyOverviewParams) {
    try {
        const emailHtml = await render(
            MonthlyOverviewEmail({
                organizationName: params.organizationName,
                month: params.month,
                topCourses: params.topCourses,
                strugglingObjectives: params.strugglingObjectives,
                retrainingStats: params.retrainingStats,
                reportUrl: params.reportUrl,
            })
        );

        const { data, error } = await resend.emails.send({
            from: "Theraptly Training <noreply@theraptly.com>",
            to: params.to,
            subject: `Monthly Training Performance – ${params.organizationName}`,
            html: emailHtml,
            attachments: params.attachments,
        });

        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error("Failed to send monthly report:", error);
        return { success: false, error };
    }
}
