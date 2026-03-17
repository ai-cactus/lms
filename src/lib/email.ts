import nodemailer from 'nodemailer';

const user = process.env.SMTP_USER || process.env.ZOHO_MAIL_USER;
const pass = process.env.SMTP_PASSWORD || process.env.ZOHO_MAIL_PASSWORD;
const host = process.env.SMTP_HOST || 'smtp.zoho.com';
const port = parseInt(process.env.SMTP_PORT || '465');
const secure = port === 465; // Typically true for 465, false for 587 (requires STARTTLS)

if (!user || !pass) {
  console.warn('SMTP credentials not found in environment variables');
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: {
    user,
    pass,
  },
});

export async function sendInviteEmail(
  to: string,
  inviteLink: string,
  orgName: string,
  role: string,
) {
  const appName = 'Theraptly';
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
    console.log(`[Email Debug] Sending invite to: ${to}`);
    console.log(`[Email Debug] Invite Link: ${inviteLink}`);
    console.log(`[Email Debug] Org: ${orgName}`);

    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      subject: `Join ${orgName} on ${appName}`,
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
  const appName = 'Theraptly LMS';

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
      from: `"Theraptly Security" <${user}>`,
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
  const baseUrl =
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://staging-lms.theraptly.com';
  const verifyLink = `${baseUrl}/api/auth/verify?token=${token}`;
  const appName = 'Theraptly';

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
      from: `"Theraptly" <${user}>`,
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

export const sendCourseInviteEmail = async (
  email: string,
  password: string,
  courseName: string,
  orgName: string,
) => {
  const baseUrl =
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://staging-lms.theraptly.com';
  const loginLink = `${baseUrl}/login`;
  const appName = 'Theraptly';

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #4C6EF5; font-size: 28px; margin: 0;">You've been assigned a course!</h1>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                <strong>${orgName}</strong> has assigned you the course: <strong>${courseName}</strong>
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                An account has been created for you. Use the credentials below to log in and start your training:
            </p>
            <div style="background: #f7fafc; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; color: #4a5568;"><strong>Email:</strong> ${email}</p>
                <p style="margin: 0; color: #4a5568;"><strong>Temporary Password:</strong> <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px;">${password}</code></p>
            </div>
            <p style="color: #718096; font-size: 14px;">
                We recommend changing your password after your first login.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${loginLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Log In to Start Training</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                If you have questions, please contact your administrator.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to: email,
      subject: `You've been assigned: ${courseName} - ${appName}`,
      html,
    });
    console.log('Course invite email sent: %s', info.messageId);
    return { success: true };
  } catch (error) {
    console.error('Error sending course invite email:', error);
    return { success: false, error };
  }
};

export const sendCourseEnrollmentEmail = async (
  email: string,
  userName: string,
  courseName: string,
  orgName: string,
) => {
  const baseUrl =
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://staging-lms.theraptly.com';
  const loginLink = `${baseUrl}/login`;
  const appName = 'Theraptly';

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #4C6EF5; font-size: 28px; margin: 0;">You've been assigned a new course!</h1>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${userName}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                <strong>${orgName}</strong> has assigned you a new training course:
            </p>
            <div style="background: #f7fafc; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
                <h3 style="margin: 0; color: #2D3748; font-size: 20px;">${courseName}</h3>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Please log in to your account to start this course.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${loginLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Log In to Training Dashboard</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                If you have questions, please contact your administrator.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to: email,
      subject: `New Course Assignment: ${courseName} - ${appName}`,
      html,
    });
    console.log('Course enrollment email sent: %s', info.messageId);
    return { success: true };
  } catch (error) {
    console.error('Error sending course enrollment email:', error);
    return { success: false, error };
  }
};

// Send email to admin when a worker exhausts quiz attempts
export async function sendQuizLockedEmail(
  adminEmail: string,
  workerName: string,
  quizTitle: string,
  courseName: string,
  attemptsUsed: number,
  actionLink: string,
) {
  const appName = 'Theraptly';
  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #E53E3E;">⚠️ Action Required: Worker Locked Out of Quiz</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                A worker has exhausted all quiz attempts and requires a retake assignment:
            </p>
            <div style="background: #FFF5F5; border-left: 4px solid #E53E3E; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 4px 0;"><strong>Worker:</strong> ${workerName}</p>
                <p style="margin: 4px 0;"><strong>Course:</strong> ${courseName}</p>
                <p style="margin: 4px 0;"><strong>Quiz:</strong> ${quizTitle}</p>
                <p style="margin: 4px 0;"><strong>Attempts Used:</strong> ${attemptsUsed}</p>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Please review and assign a retake if appropriate.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${actionLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Assign Retake</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                This is an automated notification from ${appName}.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to: adminEmail,
      subject: `Action Required: ${workerName} locked out of quiz - ${appName}`,
      html,
    });
    console.log('Quiz locked email sent: %s', info.messageId);
    return { success: true };
  } catch (error) {
    console.error('Error sending quiz locked email:', error);
    return { success: false, error };
  }
}
