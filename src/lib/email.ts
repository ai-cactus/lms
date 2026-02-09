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

export const sendEmailVerification = async (email: string, token: string) => {
    // Use APP_URL for server-side, fallback to NEXT_PUBLIC_APP_URL
    const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://staging-lms.theraptly.com';
    const verifyLink = `${baseUrl}/api/auth/verify?token=${token}`;
    const appName = "Theraptly";

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #4C6EF5; font-size: 28px; margin: 0;">Verify your email</h1>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Thank you for signing up for <strong>${appName}</strong>! 
                Please verify your email address by clicking the button below.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${verifyLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Verify Email</a>
            </div>
            <p style="color: #718096; font-size: 14px; text-align: center;">
                This link expires in <strong>5 minutes</strong>.
            </p>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                If you didn't create an account with ${appName}, you can safely ignore this email.
            </p>
        </div>
    `;

    try {
        const info = await transporter.sendMail({
            from: `"Theraptly" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `Verify your email - ${appName}`,
            html,
        });
        console.log('Email verification sent: %s', info.messageId);
        return { success: true };
    } catch (error) {
        console.error('Error sending email verification:', error);
        return { success: false, error };
    }
};
