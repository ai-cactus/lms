import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import WorkerWelcomeEmail from "@/emails/worker-welcome";
// WorkerWelcomeAutoLoginEmail will be imported dynamically
import TrainingReminderEmail from "@/emails/training-reminder";
import WeeklySnapshotEmail from "@/emails/weekly-snapshot";
import MonthlyOverviewEmail from "@/emails/monthly-overview";

// Create Zoho SMTP transporter
// Create Zoho SMTP transporter
// TODO: Enter the new Zoho credentials from Mr. Seyi below
const SENDER_EMAIL = ""; // Leave space for email
const ZOHO_PASSWORD = ""; // Leave space for password

const transporter = nodemailer.createTransport({
    host: process.env.ZOHO_SMTP_HOST || "smtp.zoho.com",
    port: parseInt(process.env.ZOHO_SMTP_PORT || "587"),
    secure: false, // true for 465, false for other ports
    auth: {
        user: SENDER_EMAIL || process.env.ZOHO_EMAIL!, // Fallback to env if set, but prioritize the new var
        pass: ZOHO_PASSWORD || process.env.ZOHO_PASSWORD!,
    },
    tls: {
        rejectUnauthorized: false
    }
});

interface SendWorkerWelcomeParams {
    to: string;
    workerName: string;
    organizationName: string;
    tempPassword?: string; // Optional for tokenized access
    assignedCourses: string[];
    courseAccessLinks?: { courseTitle: string; accessUrl: string; deadline?: string }[]; // New tokenized links
    useTokenizedAccess?: boolean; // Flag to determine email type
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

export async function sendWorkerInvitationWithTokens(params: {
    to: string;
    workerName: string;
    organizationName: string;
    courseAccessLinks: { courseTitle: string; accessUrl: string; deadline?: string }[];
}) {
    try {
        // Create a simple HTML email for tokenized access
        const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Training Assignment - ${params.organizationName}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #4F46E5; color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: white; padding: 30px 20px; border: 1px solid #e5e7eb; }
                .course-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 15px 0; }
                .course-title { font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 8px; }
                .deadline { color: #dc2626; font-size: 14px; margin-bottom: 15px; }
                .access-button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
                .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Training Assignment</h1>
                    <p>Welcome to ${params.organizationName}</p>
                </div>
                
                <div class="content">
                    <h2>Hello ${params.workerName},</h2>
                    <p>You have been assigned the following training courses. Click the links below to access each course directly - no login required!</p>
                    
                    ${params.courseAccessLinks.map(course => `
                        <div class="course-card">
                            <div class="course-title">${course.courseTitle}</div>
                            ${course.deadline ? `<div class="deadline">Deadline: ${course.deadline}</div>` : ''}
                            <a href="${course.accessUrl}" class="access-button">Start Course</a>
                        </div>
                    `).join('')}
                    
                    <p><strong>Important:</strong></p>
                    <ul>
                        <li>These links are secure and personalized for you</li>
                        <li>No login is required - just click and start learning</li>
                        <li>Complete all assigned courses by their deadlines</li>
                        <li>Contact your supervisor if you have any questions</li>
                    </ul>
                </div>
                
                <div class="footer">
                    <p>This email was sent by ${params.organizationName} Training System</p>
                    <p>Please do not reply to this email</p>
                </div>
            </div>
        </body>
        </html>
        `;

        const info = await transporter.sendMail({
            from: `"Theraptly" <${SENDER_EMAIL || process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject: `Training Assignment - ${params.organizationName}`,
            html: emailHtml,
        });

        return { success: true, data: info };
    } catch (error) {
        console.error("Failed to send tokenized invitation email:", error);
        return { success: false, error };
    }
}

export async function sendWorkerWelcomeEmail(params: SendWorkerWelcomeParams) {
    try {
        const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login`;

        const emailHtml = await render(
            WorkerWelcomeEmail({
                workerName: params.workerName,
                organizationName: params.organizationName,
                loginUrl,
                tempPassword: params.tempPassword || "",
                assignedCourses: params.assignedCourses,
            })
        );

        const info = await transporter.sendMail({
            from: `"Theraptly" <${SENDER_EMAIL || process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject: `Welcome to ${params.organizationName} Training Portal`,
            html: emailHtml,
        });

        return { success: true, data: info };
    } catch (error) {
        console.error("Failed to send welcome email:", error);
        return { success: false, error };
    }
}

export async function sendWorkerWelcomeWithAutoLogin(params: {
    to: string;
    workerName: string;
    organizationName: string;
    autoLoginUrl: string;
    assignedCourses: string[];
    hasAutoLogin: boolean;
}) {
    try {
        // Dynamic import to avoid module resolution issues
        const { default: WorkerWelcomeAutoLoginEmail } = await import("@/emails/worker-welcome-auto-login");

        const emailHtml = await render(
            WorkerWelcomeAutoLoginEmail({
                workerName: params.workerName,
                organizationName: params.organizationName,
                autoLoginUrl: params.autoLoginUrl,
                assignedCourses: params.assignedCourses,
                hasAutoLogin: params.hasAutoLogin,
            })
        );

        const info = await transporter.sendMail({
            from: `"Theraptly" <${SENDER_EMAIL || process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject: `Welcome to ${params.organizationName} Training Portal - Start Your Training`,
            html: emailHtml,
        });

        return { success: true, data: info };
    } catch (error) {
        console.error("Failed to send auto-login welcome email:", error);
        return { success: false, error };
    }
}

export async function sendCourseAssignmentNotification(params: {
    to: string;
    workerName: string;
    courseTitle: string;
    organizationName: string;
    accessUrl: string;
    deadline: string;
}) {
    try {
        const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Course Assignment - ${params.organizationName}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #4F46E5; color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: white; padding: 30px 20px; border: 1px solid #e5e7eb; }
                .course-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 15px 0; }
                .course-title { font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 8px; }
                .deadline { color: #dc2626; font-size: 14px; margin-bottom: 15px; }
                .access-button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
                .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>New Course Assignment</h1>
                    <p>${params.organizationName}</p>
                </div>

                <div class="content">
                    <h2>Hello ${params.workerName},</h2>
                    <p>You have been assigned a new training course. Please complete it by the specified deadline.</p>

                    <div class="course-card">
                        <div class="course-title">${params.courseTitle}</div>
                        <div class="deadline">Deadline: ${params.deadline}</div>
                        <a href="${params.accessUrl}" class="access-button">Start Course</a>
                    </div>

                    <p><strong>Important:</strong></p>
                    <ul>
                        <li>Complete the course before the deadline</li>
                        <li>Contact your supervisor if you have any questions</li>
                        <li>Your progress will be tracked and reported</li>
                    </ul>
                </div>

                <div class="footer">
                    <p>This email was sent by ${params.organizationName} Training System</p>
                    <p>Please do not reply to this email</p>
                </div>
            </div>
        </body>
        </html>
        `;

        const info = await transporter.sendMail({
            from: `"Theraptly" <${SENDER_EMAIL || process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject: `New Course Assignment: ${params.courseTitle}`,
            html: emailHtml,
        });

        return { success: true, data: info };
    } catch (error) {
        console.error("Failed to send course assignment notification:", error);
        return { success: false, error };
    }
}

export async function sendWorkerWelcomeWithCourseAccess(params: {
    to: string;
    workerName: string;
    organizationName: string;
    courseAccessLinks: Array<{
        courseTitle: string;
        courseDescription: string;
        autoLoginUrl: string;
        assignmentId: string;
    }>;
    fallbackLoginUrl: string;
    hasAutoLogin: boolean;
    tempPassword?: string;
}) {
    try {
        // Dynamic import to avoid module resolution issues
        const { default: WorkerWelcomeCourseAccessEmail } = await import("@/emails/worker-welcome-course-access");

        const emailHtml = await render(
            WorkerWelcomeCourseAccessEmail({
                workerName: params.workerName,
                organizationName: params.organizationName,
                courseAccessLinks: params.courseAccessLinks,
                fallbackLoginUrl: params.fallbackLoginUrl || `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login`,
                hasAutoLogin: params.hasAutoLogin,
                tempPassword: params.tempPassword,
            })
        );


        const info = await transporter.sendMail({
            from: `"Theraptly" <${SENDER_EMAIL || process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject: `Welcome to ${params.organizationName}`,
            html: emailHtml,
        });

        return { success: true, data: info };
    } catch (error) {
        console.error("Failed to send course access welcome email:", error);
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
            ? `Overdue: ${params.courseTitle}`
            : `Reminder: ${params.courseTitle} due in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`;

        const info = await transporter.sendMail({
            from: `"Theraptly" <${SENDER_EMAIL || process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject,
            html: emailHtml,
        });

        return { success: true, data: info };
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

        const info = await transporter.sendMail({
            from: `"Theraptly" <${SENDER_EMAIL || process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject: `Weekly Compliance Snapshot – ${params.organizationName}`,
            html: emailHtml,
        });

        return { success: true, data: info };
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

        const info = await transporter.sendMail({
            from: `"Theraptly Training" <${process.env.ZOHO_EMAIL!}>`,
            to: params.to,
            subject: `Monthly Training Performance – ${params.organizationName}`,
            html: emailHtml,
            attachments: params.attachments?.map(att => ({
                filename: att.filename,
                content: att.content
            })),
        });

        return { success: true, data: info };
    } catch (error) {
        console.error("Failed to send monthly report:", error);
        return { success: false, error };
    }
}
