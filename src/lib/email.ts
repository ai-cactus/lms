import nodemailer from 'nodemailer';

const user = process.env.SMTP_USER || process.env.ZOHO_MAIL_USER;
const pass = process.env.SMTP_PASSWORD || process.env.ZOHO_MAIL_PASSWORD;
const host = process.env.SMTP_HOST || 'smtp.zoho.com';
const port = parseInt(process.env.SMTP_PORT || '465');
const secure = port === 465; // Typically true for 465, false for 587 (requires STARTTLS)

if (!user || !pass) {
    console.warn("SMTP credentials not found in environment variables");
}

const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
        user,
        pass
    }
});

export async function sendInviteEmail(to: string, inviteLink: string, orgName: string, role: string) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4C6EF5;">You've been invited!</h2>
            <p><strong>${orgName}</strong> has invited you to join their team as a <strong>${role}</strong>.</p>
            <p>Click the link below to accept the invitation and set up your account:</p>
            <a href="${inviteLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 16px;">Accept Invitation</a>
            <p style="margin-top: 24px; font-size: 12px; color: #718096;">Link expires in 7 days.</p>
            <p style="font-size: 12px; color: #718096;">If you didn't expect this invitation, you can ignore this email.</p>
        </div>
    `;

    try {
        const info = await transporter.sendMail({
            from: `"Theraptly LMS" <${user}>`,
            to,
            subject: `Join ${orgName} on Theraptly`,
            html,
        });
        console.log('Message sent: %s', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error };
    }
}

export const sendPasswordResetEmail = async (email: string, token: string) => {
    const resetLink = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;

    // Fallback if env var is missing or localhost
    const appName = "Theraptly LMS";

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4C6EF5;">Password Reset Request</h2>
            <p>You requested a password reset for your <strong>${appName}</strong> account.</p>
            <p>Click the link below to set a new password:</p>
            <a href="${resetLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 16px;">Reset Password</a>
            <p style="margin-top: 24px; font-size: 12px; color: #718096;">Link expires in 1 hour.</p>
            <p style="font-size: 12px; color: #718096;">If you didn't request this, you can safely ignore this email.</p>
        </div>
    `;

    try {
        const info = await transporter.sendMail({
            from: `"Theraptly Security" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `Reset your password - ${appName}`,
            html,
        });
        console.log('Password reset sent: %s', info.messageId);
        return { success: true };
    } catch (error) {
        console.error('Error sending password reset email:', error);
        return { success: false, error };
    }
};
