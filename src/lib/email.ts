
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

export async function sendPasswordResetEmail(email: string, token: string) {
    const resetLink = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;

    try {
        const info = await transporter.sendMail({
            from: `"LMS Support" <${process.env.SMTP_USER}>`,
            to: email,
            subject: "Reset Your Password",
            text: `Click the following link to reset your password: ${resetLink} . This link expires in 1 hour.`,
            html: `
        <div style="font-family: sans-serif; padding: 20px;">
            <h2>Password Reset Request</h2>
            <p>You requested a password reset. Click the button below to set a new password:</p>
            <a href="${resetLink}" style="background: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">Reset Password</a>
            <p style="color: #64748B; font-size: 14px;">Or copy this link: <br>${resetLink}</p>
            <p>This link expires in 1 hour.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
        });

        console.log("Message sent: %s", info.messageId);
        return { success: true };
    } catch (error) {
        console.error("Error sending email:", error);
        return { success: false, error: "Failed to send email" };
    }
}
