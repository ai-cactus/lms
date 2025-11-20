import { Resend } from "resend";
import { render } from "@react-email/render";
import WorkerWelcomeEmail from "@/emails/worker-welcome";
import TrainingReminderEmail from "@/emails/training-reminder";

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
