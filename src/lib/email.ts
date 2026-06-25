import nodemailer from 'nodemailer';
import { logger } from './logger';

/**
 * Escape a string for safe interpolation into HTML email bodies.
 * Defense-in-depth: prevents user-supplied values (names, org names, course
 * titles, free-text form fields, …) from injecting markup into the rendered
 * email. Apply to HTML bodies only — never to subject lines or filenames.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const user = process.env.SMTP_USER || process.env.ZOHO_MAIL_USER;
const pass = process.env.SMTP_PASSWORD || process.env.ZOHO_MAIL_PASSWORD;
const host = process.env.SMTP_HOST || 'smtp.zoho.com';
const port = parseInt(process.env.SMTP_PORT || '465', 10);
// Port 465 = implicit TLS (secure: true). Port 587 = STARTTLS (secure: false + requireTLS: true).
const secure = port === 465;

if (!user || !pass) {
  logger.warn({ msg: 'SMTP credentials not found in environment variables' });
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS: !secure, // Force STARTTLS on port 587 — prevents plaintext fallback
  connectionTimeout: 10_000, // 10 s — fail fast instead of hanging
  greetingTimeout: 8_000, // 8 s — max time to wait for server greeting
  socketTimeout: 10_000, // 10 s — idle socket timeout per send
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
            <p><strong>${escapeHtml(orgName)}</strong> has invited you to join their team as a <strong>${escapeHtml(role)}</strong>.</p>
            <p>Click the link below to accept the invitation and set up your account:</p>
            <a href="${inviteLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 16px;">Accept Invitation</a>
            <p style="margin-top: 24px; font-size: 12px; color: #718096;">Link expires in 7 days.</p>
            <p style="font-size: 12px; color: #718096;">If you didn't expect this invitation, you can ignore this email.</p>
        </div>
    `;

  try {
    logger.info({ msg: `[Email Debug] Sending invite to: ${to}` });
    logger.info({ msg: `[Email Debug] Invite Link: ${inviteLink}` });
    logger.info({ msg: `[Email Debug] Org: ${orgName}` });

    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      subject: `Join ${orgName} on ${appName}`,
      html,
    });
    logger.info({ msg: 'Message sent: %s', data: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ msg: 'Error sending email:', err: error });
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
    logger.info({ msg: 'Password reset sent: %s', data: info.messageId });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error sending password reset email:', err: error });
    return { success: false, error };
  }
};

export const sendMfaOtpEmail = async (email: string, code: string) => {
  const appName = 'Theraptly LMS';

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4C6EF5;">Your Authentication Code</h2>
            <p>You are trying to sign in or enable Two-Factor Authentication on your <strong>${appName}</strong> account.</p>
            <p>Your 6-digit verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #1a202c; padding: 16px; background: #f7fafc; border-radius: 8px; text-align: center; margin: 24px 0;">
              ${code}
            </div>
            <p style="margin-top: 24px; font-size: 12px; color: #718096;">Code expires in 15 minutes.</p>
            <p style="font-size: 12px; color: #718096;">If you didn't request this, you can safely ignore this email.</p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"Theraptly Security" <${user}>`,
      to: email,
      subject: `Your ${appName} verification code`,
      html,
    });
    logger.info({ msg: 'MFA OTP email sent', messageId: info.messageId });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error sending MFA OTP email:', err: error });
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
                This link expires in <strong>24 hours</strong>.
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
    logger.info({ msg: 'Email verification sent: %s', data: info.messageId });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error sending email verification:', err: error });
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
                <strong>${escapeHtml(orgName)}</strong> has assigned you the course: <strong>${escapeHtml(courseName)}</strong>
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                An account has been created for you. Use the credentials below to log in and start your training:
            </p>
            <div style="background: #f7fafc; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; color: #4a5568;"><strong>Email:</strong> ${escapeHtml(email)}</p>
                <p style="margin: 0; color: #4a5568;"><strong>Temporary Password:</strong> <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px;">${escapeHtml(password)}</code></p>
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
    logger.info({ msg: 'Course invite email sent: %s', data: info.messageId });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error sending course invite email:', err: error });
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
                Hi <strong>${escapeHtml(userName)}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                <strong>${escapeHtml(orgName)}</strong> has assigned you a new training course:
            </p>
            <div style="background: #f7fafc; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
                <h3 style="margin: 0; color: #2D3748; font-size: 20px;">${escapeHtml(courseName)}</h3>
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
    logger.info({ msg: 'Course enrollment email sent: %s', data: info.messageId });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error sending course enrollment email:', err: error });
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
                <p style="margin: 4px 0;"><strong>Worker:</strong> ${escapeHtml(workerName)}</p>
                <p style="margin: 4px 0;"><strong>Course:</strong> ${escapeHtml(courseName)}</p>
                <p style="margin: 4px 0;"><strong>Quiz:</strong> ${escapeHtml(quizTitle)}</p>
                <p style="margin: 4px 0;"><strong>Attempts Used:</strong> ${escapeHtml(attemptsUsed)}</p>
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
    logger.info({ msg: 'Quiz locked email sent: %s', data: info.messageId });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error sending quiz locked email:', err: error });
    return { success: false, error };
  }
}

export async function sendEnterpriseInquiryEmail({
  to,
  firstName,
  lastName,
  workEmail,
  jobTitle,
  organizationName,
  facilityType,
  numberOfFacilities,
  numberOfStaff,
  currentAccreditation,
  currentTrainingMethod,
  primaryPainPoint,
  authUserEmail,
  orgName,
}: {
  to: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  jobTitle: string;
  organizationName: string;
  facilityType: string;
  numberOfFacilities: string;
  numberOfStaff: string;
  currentAccreditation: string;
  currentTrainingMethod: string;
  primaryPainPoint: string;
  /** Authenticated session email — used as reply-to fallback */
  authUserEmail: string;
  /** Organization name from the DB (may differ from form input) */
  orgName: string;
}) {
  const appName = 'Theraptly';
  const contactName = [firstName, lastName].filter(Boolean).join(' ') || 'Not provided';
  const replyToEmail = workEmail || authUserEmail;

  /** Renders a table row only when the value is non-empty */
  const row = (label: string, value: string) =>
    value
      ? `<tr>
           <td style="padding: 8px 12px; font-weight: 600; color: #4a5568; white-space: nowrap; vertical-align: top; width: 40%;">${label}</td>
           <td style="padding: 8px 12px; color: #2d3748; vertical-align: top;">${value}</td>
         </tr>`
      : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 40px 20px; background: #f8f9fc;">
      <!-- Header -->
      <div style="background: #4C6EF5; border-radius: 12px 12px 0 0; padding: 28px 32px;">
        <h1 style="margin: 0; color: #ffffff; font-size: 22px;">New Enterprise Plan Inquiry</h1>
        <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
          Submitted via the ${appName} billing page
        </p>
      </div>

      <!-- Body card -->
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 32px;">

        <!-- Contact details -->
        <h2 style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin: 0 0 12px 0;">Contact Details</h2>
        <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
          <tbody>
            ${row('Full Name', escapeHtml(contactName))}
            ${row('Work Email', `<a href="mailto:${encodeURIComponent(workEmail)}" style="color: #4C6EF5;">${escapeHtml(workEmail)}</a>`)}
            ${row('Job Title', escapeHtml(jobTitle))}
          </tbody>
        </table>

        <!-- Organization details -->
        <h2 style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin: 0 0 12px 0;">Organization Details</h2>
        <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
          <tbody>
            ${row('Organization', escapeHtml(organizationName))}
            ${row('DB Org (session)', orgName !== organizationName ? escapeHtml(orgName) : '')}
            ${row('Facility Type', escapeHtml(facilityType))}
            ${row('No. of Facilities', escapeHtml(numberOfFacilities))}
            ${row('No. of Staff', escapeHtml(numberOfStaff))}
          </tbody>
        </table>

        <!-- Training context -->
        <h2 style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin: 0 0 12px 0;">Training Context</h2>
        <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
          <tbody>
            ${row('Current Accreditation', escapeHtml(currentAccreditation))}
            ${row('Current Training Method', escapeHtml(currentTrainingMethod))}
          </tbody>
        </table>

        <!-- Pain point -->
        ${
          primaryPainPoint
            ? `<h2 style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin: 0 0 12px 0;">Primary Pain Point</h2>
               <div style="background: #f8fafc; border-left: 4px solid #4C6EF5; border-radius: 0 8px 8px 0; padding: 16px 20px; margin-bottom: 24px;">
                 <p style="margin: 0; color: #2d3748; line-height: 1.6;">${escapeHtml(primaryPainPoint)}</p>
               </div>`
            : ''
        }

        <!-- CTA -->
        <div style="text-align: center; margin-top: 8px;">
          <a href="mailto:${encodeURIComponent(replyToEmail)}"
             style="display: inline-block; background: #4C6EF5; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Reply to ${escapeHtml(contactName)}
          </a>
        </div>
      </div>

      <p style="color: #94a3b8; font-size: 12px; margin-top: 16px; text-align: center;">
        This is an automated notification from ${appName}.
      </p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      replyTo: replyToEmail,
      subject: `Enterprise Plan Inquiry — ${organizationName}`,
      html,
    });
    logger.info({ msg: '[Email] Enterprise inquiry sent: %s', data: info.messageId });
    return { success: true };
  } catch (error) {
    logger.error({ msg: '[Email] Error sending enterprise inquiry:', err: error });
    return { success: false, error };
  }
}

export async function sendStaffRemovedEmail(email: string, orgName: string) {
  const appName = 'Theraptly';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #4C6EF5;">Account Update</h2>
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        This is to inform you that your account has been disconnected from <strong>${escapeHtml(orgName)}</strong> on ${appName}.
      </p>
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        You will no longer be able to access the courses or dashboard associated with this organization.
      </p>
      <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
        If you believe this was a mistake, please contact your administrator at ${escapeHtml(orgName)}.
      </p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to: email,
      subject: `Account disconnected from ${orgName} - ${appName}`,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ msg: 'Error sending staff removed email:', err: error });
    return { success: false, error };
  }
}

export async function sendStaffRemovalConfirmationEmail(
  adminEmail: string,
  staffName: string,
  orgName: string,
) {
  const appName = 'Theraptly';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #4C6EF5;">Staff Removal Confirmed</h2>
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        This email confirms that <strong>${escapeHtml(staffName)}</strong> has been successfully removed from your organization, <strong>${escapeHtml(orgName)}</strong>.
      </p>
      <p style="color: #718096; font-size: 12px; margin-top: 32px;">
        This is an automated confirmation from ${appName}.
      </p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to: adminEmail,
      subject: `Staff Removal Confirmed: ${staffName} - ${appName}`,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ msg: 'Error sending staff removal confirmation email:', err: error });
    return { success: false, error };
  }
}

export async function sendDemoRequestEmail(data: {
  fullName: string;
  email: string;
  organizationName: string;
  role: string;
  helpUs: string;
  demoTime: string;
}) {
  const appName = 'Theraptly';
  const to =
    process.env.ENTERPRISE_CONTACT_EMAIL || process.env.SMTP_USER || process.env.ZOHO_MAIL_USER;

  if (!to) {
    logger.error({
      msg: 'No ENTERPRISE_CONTACT_EMAIL or SMTP_USER configured to receive demo requests.',
    });
    return { success: false, error: 'Misconfigured email environment variables.' };
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background: #4C6EF5; padding: 24px;">
        <h2 style="color: #ffffff; margin: 0;">New Demo Request</h2>
      </div>
      <div style="padding: 32px 24px;">
        <p style="color: #333; font-size: 16px; margin-top: 0;">
          A new demo request has been submitted for <strong>${appName}</strong>:
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 24px;">
          <tbody>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #4a5568; width: 35%;">Name</td><td style="padding: 8px 0; color: #2d3748;">${escapeHtml(data.fullName)}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #4a5568;">Email</td><td style="padding: 8px 0;"><a href="mailto:${encodeURIComponent(data.email)}" style="color: #4C6EF5;">${escapeHtml(data.email)}</a></td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #4a5568;">Organization</td><td style="padding: 8px 0; color: #2d3748;">${escapeHtml(data.organizationName)}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #4a5568;">Role</td><td style="padding: 8px 0; color: #2d3748;">${escapeHtml(data.role)}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #4a5568; vertical-align: top;">Challenges</td><td style="padding: 8px 0; color: #2d3748;">${escapeHtml(data.helpUs)}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #4a5568;">Preferred Time</td><td style="padding: 8px 0; color: #2d3748;">${escapeHtml(data.demoTime)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      replyTo: data.email,
      subject: `New Demo Request: ${data.organizationName} - ${appName}`,
      html,
    });
    logger.info({ msg: 'Demo request email sent', messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ msg: 'Error sending demo request email', error });
    return { success: false, error };
  }
}

// ---------------------------------------------------------------------------
// PDF Report Emails
// ---------------------------------------------------------------------------

/**
 * Sends a staff member's activity report PDF to the admin as an email attachment.
 */
export async function sendUserActivityReportEmail(
  adminEmail: string,
  staffName: string,
  orgName: string,
  pdfBuffer: Buffer,
): Promise<{ success: boolean; error?: unknown }> {
  const appName = 'Theraptly';
  const now = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const fileName = `activity-report-${staffName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #4C6EF5; border-radius: 12px 12px 0 0; padding: 28px 32px;">
        <h1 style="margin: 0; color: #ffffff; font-size: 20px;">User Activity Report</h1>
        <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.8); font-size: 13px;">${appName} LMS · Generated ${now}</p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 28px 32px;">
        <p style="color: #333; font-size: 15px; line-height: 1.6; margin-top: 0;">
          Please find attached the learning activity report for <strong>${escapeHtml(staffName)}</strong> from <strong>${escapeHtml(orgName)}</strong>.
        </p>
        <p style="color: #333; font-size: 15px; line-height: 1.6;">
          The report contains course assignments, grades, and completion dates for all enrolled courses.
        </p>
        <p style="color: #718096; font-size: 12px; margin-top: 32px;">
          This is an automated report from ${appName}. If you did not request this, please ignore this email.
        </p>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to: adminEmail,
      subject: `Activity Report: ${staffName} — ${orgName}`,
      html,
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
    logger.info({ msg: '[email] User activity report sent', messageId: info.messageId, staffName });
    return { success: true };
  } catch (error) {
    logger.error({ msg: '[email] Failed to send user activity report', err: error });
    return { success: false, error };
  }
}

/**
 * Sends the auditor pack PDF export to the admin as an email attachment.
 */
export async function sendAuditorPackPdfEmail(
  adminEmail: string,
  orgName: string,
  pdfBuffer: Buffer,
): Promise<{ success: boolean; error?: unknown }> {
  const appName = 'Theraptly';
  const now = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const fileName = `auditor-pack-${orgName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="background: #4C6EF5; border-radius: 12px 12px 0 0; padding: 28px 32px;">
        <h1 style="margin: 0; color: #ffffff; font-size: 20px;">Auditor Pack — PDF Export</h1>
        <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.8); font-size: 13px;">${appName} LMS · Generated ${now}</p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 28px 32px;">
        <p style="color: #333; font-size: 15px; line-height: 1.6; margin-top: 0;">
          Your auditor pack export for <strong>${escapeHtml(orgName)}</strong> is attached.
        </p>
        <p style="color: #333; font-size: 15px; line-height: 1.6;">
          The document contains all staff learning activity, grades, completion dates, and course categories
          as of ${now}. You can share this directly with your auditors.
        </p>
        <p style="color: #718096; font-size: 12px; margin-top: 32px;">
          This is an automated export from ${appName}. If you did not request this, please ignore this email.
        </p>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to: adminEmail,
      subject: `Auditor Pack Export — ${orgName}`,
      html,
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
    logger.info({ msg: '[email] Auditor pack PDF sent', messageId: info.messageId, orgName });
    return { success: true };
  } catch (error) {
    logger.error({ msg: '[email] Failed to send auditor pack PDF', err: error });
    return { success: false, error };
  }
}
