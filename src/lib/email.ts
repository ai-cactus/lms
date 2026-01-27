import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com',
    port: parseInt(process.env.ZOHO_SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.ZOHO_EMAIL,
        pass: process.env.ZOHO_PASSWORD,
    },
});

interface WelcomeEmailParams {
    to: string;
    organizationName: string;
    actionLink: string; // The Supabase invite/setup password link
}

interface CourseAssignmentEmailParams {
    to: string;
    userName: string;
    courseTitle: string;
    courseUrl: string;
    inviterName: string;
    deadline?: string;
}

export async function sendWelcomeEmail({ to, organizationName, actionLink }: WelcomeEmailParams) {
    const htmlKey = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #334155;">
        <!-- Banner -->
        <div style="background-color: #4E61F6; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Welcome to ${organizationName} Training Centre</h1>
        </div>
        
        <!-- Welcome Message -->
        <div style="padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background-color: white;">
            <p style="text-align: center; font-size: 16px; color: #64748b; margin-bottom: 30px;">
                Your account is active. Courses will appear here once they’re assigned.
            </p>

            <p style="font-size: 16px;">Hi there,</p>
            <p style="font-size: 16px; line-height: 1.6;">
                Your training account is ready.<br>
                When your supervisor/admin assigns courses, they’ll appear in your dashboard and you’ll receive a notification.
                To protect your account, you’ll be prompted to change your password on first login.
            </p>

            <!-- Action Button -->
            <div style="text-align: center; margin: 35px 0;">
                <a href="${actionLink}" style="background-color: #4E61F6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; display: inline-block;">
                    Access Your Account
                </a>
            </div>

            <!-- Security Section -->
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-top: 30px;">
                <h3 style="color: #1e293b; margin-top: 0; font-size: 18px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px;">
                    Security & access checklist
                </h3>
                <ul style="padding-left: 20px; margin: 0; color: #475569; font-size: 14px; line-height: 1.6;">
                    <li style="margin-bottom: 8px;"><strong>Unique access:</strong> This sign-in link is tied to your account, don’t share it.</li>
                    <li style="margin-bottom: 8px;"><strong>Link expires in 30 days:</strong> If it expires, request a new link from your supervisor/admin.</li>
                    <li><strong>Meet deadlines:</strong> Complete courses before the due dates shown in your dashboard.</li>
                </ul>
            </div>

            <p style="margin-top: 30px; font-size: 14px; color: #94a3b8; text-align: center;">
                Need help? Contact your supervisor/admin.
            </p>
        </div>
    </div>
    `;

    return transporter.sendMail({
        from: `"Theraptly LMS" <${process.env.ZOHO_EMAIL}>`,
        to,
        subject: `Welcome to ${organizationName} Training Centre`,
        html: htmlKey,
    });
}

export async function sendCourseAssignmentEmail({ to, userName, courseTitle, courseUrl, inviterName, deadline }: CourseAssignmentEmailParams) {
    const htmlKey = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #4E61F6;">New Course Assigned</h2>
        <p>Hi ${userName},</p>
        <p>You have been assigned a new course by <strong>${inviterName}</strong>:</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4E61F6;">
            <h3 style="margin: 0; color: #1e293b;">${courseTitle}</h3>
            ${deadline ? `<p style="color: #dc2626; font-weight: bold; margin-top: 10px; margin-bottom: 0;">Due Date: ${deadline}</p>` : ''}
        </div>

        <p>Please click the button below to start your training:</p>
        <a href="${courseUrl}" style="display: inline-block; background-color: #4E61F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Start Course</a>
        
        <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">If you are not logged in, you will be redirected to the login page first.</p>
    </div>
    `;

    return transporter.sendMail({
        from: `"Theraptly LMS" <${process.env.ZOHO_EMAIL}>`,
        to,
        subject: `New Course Assigned: ${courseTitle}`,
        html: htmlKey,
    });
}

export interface ReminderParams {
    to: string;
    workerName: string;
    courseTitle: string;
    deadline?: Date;
}

export async function sendBulkTrainingReminders(reminders: ReminderParams[]) {
    // Send emails in batches to avoid rate limits
    const results = {
        success: 0,
        failed: 0,
        errors: [] as string[]
    };

    for (const reminder of reminders) {
        try {
            await transporter.sendMail({
                from: `"Theraptly LMS" <${process.env.ZOHO_EMAIL}>`,
                to: reminder.to,
                subject: `Training Reminder: ${reminder.courseTitle}`,
                html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #4E61F6;">Training Reminder</h2>
                    <p>Hi ${reminder.workerName},</p>
                    <p>This is a reminder to complete your assigned training:</p>
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #f59e0b;">
                        <h3 style="margin: 0; color: #1e293b;">${reminder.courseTitle}</h3>
                        ${reminder.deadline ? `<p style="color: #dc2626; font-weight: bold; margin-top: 10px; margin-bottom: 0;">Due Date: ${new Date(reminder.deadline).toLocaleDateString()}</p>` : ''}
                    </div>

                    <p>Please log in to your dashboard to complete this course.</p>
                </div>
                `
            });
            results.success++;
        } catch (error: any) {
            console.error(`Failed to send reminder to ${reminder.to}:`, error);
            results.failed++;
            results.errors.push(error.message);
        }
    }

    return results;
}

interface WeeklyReportParams {
    to: string[];
    organizationName: string;
    overdueCount: number;
    pendingConfirmations: number;
    complianceRate: number;
    roleCompliance: { role: string; rate: number }[];
    dashboardUrl: string;
}

export async function sendWeeklyComplianceEmail({
    to,
    organizationName,
    overdueCount,
    pendingConfirmations,
    complianceRate,
    roleCompliance,
    dashboardUrl
}: WeeklyReportParams) {

    const roleRows = roleCompliance.map(r => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${r.role}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${r.rate}%</td>
        </tr>
    `).join('');

    const htmlKey = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #4E61F6;">Weekly Training Report</h2>
        <p style="color: #64748b; font-size: 14px; margin-top: -10px;">${organizationName}</p>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 25px 0;">
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: ${complianceRate >= 80 ? '#10b981' : '#f59e0b'};">${complianceRate}%</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 5px;">Compliance Rate</div>
            </div>
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: ${overdueCount > 0 ? '#ef4444' : '#10b981'};">${overdueCount}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 5px;">Overdue Tasks</div>
            </div>
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #3b82f6;">${pendingConfirmations}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 5px;">Pending Review</div>
            </div>
        </div>

        <h3 style="font-size: 16px; margin-top: 30px; margin-bottom: 15px;">Compliance by Role</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            ${roleRows}
        </table>

        <div style="text-align: center; margin-top: 30px;">
            <a href="${dashboardUrl}" style="display: inline-block; background-color: #4E61F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Dashboard</a>
        </div>
    </div>
    `;

    return transporter.sendMail({
        from: `"Theraptly LMS" <${process.env.ZOHO_EMAIL}>`,
        to: to.join(', '), // Nodemailer supports array or comma-separated string
        subject: `Weekly Training Report - ${organizationName}`,
        html: htmlKey,
    });
}
