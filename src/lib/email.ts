import nodemailer, { type SendMailOptions } from 'nodemailer';
import prisma from './prisma';
import { logger, maskEmail } from './logger';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
import { OTP_EXPIRY_MINUTES } from '@/lib/mfa';
import type { Role } from '@/types/next-auth';

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

/**
 * Render a deadline/due date in a friendly, human-readable form (e.g.
 * "June 30, 2026"). Mirrors the locale formatting used by the PDF report
 * emails. Returns an empty string for missing/invalid dates so callers never
 * surface "Invalid Date" to recipients.
 */
function formatDueDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const user = process.env.SMTP_USER || process.env.ZOHO_MAIL_USER;
const pass = process.env.SMTP_PASSWORD || process.env.ZOHO_MAIL_PASSWORD;
const host = process.env.SMTP_HOST || 'smtp.zoho.com';
const port = parseInt(process.env.SMTP_PORT || '465', 10);
const secure = port === 465;
const isDevelopment = process.env.NODE_ENV === 'development';
// Loopback SMTP sinks (MailHog in CI e2e / local dev) advertise neither AUTH nor
// STARTTLS — enforcing them there fails every send. Real deployments always point
// at a remote SMTP host, so hardening stays on for any non-loopback host.
const isLoopbackSmtpSink = ['localhost', '127.0.0.1', '::1'].includes(host);
const skipSmtpHardening = isDevelopment || isLoopbackSmtpSink;

if (!user || !pass) {
  logger.warn({ msg: 'SMTP credentials not found in environment variables' });
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS: skipSmtpHardening ? undefined : !secure, // Force STARTTLS on port 587 — prevents plaintext fallback
  connectionTimeout: 10_000, // 10 s — fail fast instead of hanging
  greetingTimeout: 8_000, // 8 s — max time to wait for server greeting
  socketTimeout: 10_000, // 10 s — idle socket timeout per send
  auth: skipSmtpHardening
    ? undefined
    : {
        user,
        pass,
      },
});

/** Reduce a Nodemailer `to` field to a single loggable/persistable address string. */
function normalizeRecipient(to: SendMailOptions['to']): string {
  if (!to) return 'unknown';
  if (typeof to === 'string') return to;
  if (Array.isArray(to)) {
    return to.map((entry) => (typeof entry === 'string' ? entry : entry.address)).join(', ');
  }
  return to.address;
}

/** Trim an unknown error down to a persistable message string. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown email transport error';
}

/**
 * Persist an {@link @/generated/prisma EmailMessage} delivery record. Best-effort
 * observability: tracking must never break the actual send, so all failures are
 * swallowed with an error log. Reminder-ladder sends are tracked separately by
 * `dispatch.ts` (keyed to their ReminderLog) and therefore bypass this helper.
 */
async function recordEmailMessage(data: {
  toEmail: string;
  kind: string;
  status: 'sent' | 'failed';
  sentAt?: Date;
  attempts?: number;
  lastError?: string;
}): Promise<void> {
  try {
    await prisma.emailMessage.create({ data });
  } catch (err) {
    logger.error({ msg: '[email] Failed to record email delivery', kind: data.kind, err });
  }
}

/**
 * Transport-layer wrapper around `transporter.sendMail`. Records an EmailMessage
 * row for every send — `sent` on success, `failed` (attempts = 1, lastError) on
 * failure — then returns/rethrows exactly as the raw transport would, so callers
 * keep their existing structured-result handling. `kind` classifies the send for
 * later auditing; callers pass a specific kind, defaulting to a generic one.
 */
async function sendMailTracked(options: SendMailOptions, kind = 'generic') {
  const toEmail = normalizeRecipient(options.to);
  try {
    const info = await transporter.sendMail(options);
    await recordEmailMessage({ toEmail, kind, status: 'sent', sentAt: new Date() });
    return info;
  } catch (error) {
    await recordEmailMessage({
      toEmail,
      kind,
      status: 'failed',
      attempts: 1,
      lastError: describeError(error),
    });
    throw error;
  }
}

export async function sendInviteEmail(
  to: string,
  inviteLink: string,
  orgName: string,
  role: string,
) {
  const appName = 'Theraptly';
  // `role` is a DB role slug (e.g. `behavioral_health_technician`). Render the
  // same human-readable label the in-app UI uses, and phrase it as "as: <Label>"
  // to sidestep the a/an article problem across role names.
  const roleLabel = getRoleDisplayName(role as Role);
  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4C6EF5;">You've been invited!</h2>
            <p><strong>${escapeHtml(orgName)}</strong> has invited you to join their team as: <strong>${escapeHtml(roleLabel)}</strong>.</p>
            <p>Click the link below to accept the invitation and set up your account:</p>
            <a href="${inviteLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 16px;">Accept Invitation</a>
            <p style="margin-top: 24px; font-size: 12px; color: #718096;">Link expires in 7 days.</p>
            <p style="font-size: 12px; color: #718096;">If you didn't expect this invitation, you can ignore this email.</p>
        </div>
    `;

  try {
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to,
        subject: `Join ${orgName} on ${appName}`,
        html,
      },
      'invite',
    );
    // Do NOT log the raw recipient or the tokenized invite link — the link
    // embeds a bearer token (F-067). Mask the address and log only non-sensitive
    // context.
    logger.info({ msg: '[email] Invite email sent', messageId: info.messageId, to: maskEmail(to) });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ msg: '[email] Error sending invite email', err: error, to: maskEmail(to) });
    return { success: false, error };
  }
}

export const sendPasswordResetEmail = async (email: string, token: string) => {
  const resetLink = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;

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
    const info = await sendMailTracked(
      {
        from: `"Theraptly Security" <${user}>`,
        to: email,
        subject: `Reset your password - ${appName}`,
        html,
      },
      'password_reset',
    );
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
            <p style="margin-top: 24px; font-size: 12px; color: #718096;">Code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
            <p style="font-size: 12px; color: #718096;">If you didn't request this, you can safely ignore this email.</p>
        </div>
    `;

  try {
    const info = await sendMailTracked(
      {
        from: `"Theraptly Security" <${user}>`,
        to: email,
        subject: `Your ${appName} verification code`,
        html,
      },
      'mfa_otp',
    );
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
    const info = await sendMailTracked(
      {
        from: `"Theraptly" <${user}>`,
        to: email,
        subject: `Verify your email - ${appName}`,
        html,
      },
      'email_verification',
    );
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
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to: email,
        subject: `You've been assigned: ${courseName} - ${appName}`,
        html,
      },
      'course_invite',
    );
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
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to: email,
        subject: `New Course Assignment: ${courseName} - ${appName}`,
        html,
      },
      'course_enrollment',
    );
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
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to: adminEmail,
        subject: `Action Required: ${workerName} locked out of quiz - ${appName}`,
        html,
      },
      'quiz_locked',
    );
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
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to,
        replyTo: replyToEmail,
        subject: `Enterprise Plan Inquiry — ${organizationName}`,
        html,
      },
      'enterprise_inquiry',
    );
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
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to: email,
        subject: `Account disconnected from ${orgName} - ${appName}`,
        html,
      },
      'staff_removed',
    );
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
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to: adminEmail,
        subject: `Staff Removal Confirmed: ${staffName} - ${appName}`,
        html,
      },
      'staff_removal_confirmation',
    );
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
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to,
        replyTo: data.email,
        subject: `New Demo Request: ${data.organizationName} - ${appName}`,
        html,
      },
      'demo_request',
    );
    logger.info({ msg: 'Demo request email sent', messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ msg: 'Error sending demo request email', error });
    return { success: false, error };
  }
}

export async function sendPartnerApplicationEmail(data: {
  name: string;
  email: string;
  company?: string;
  network?: string;
  message?: string;
}) {
  const appName = 'Theraptly';
  const to = process.env.PARTNER_INBOX || process.env.SMTP_USER || process.env.ZOHO_MAIL_USER;

  if (!to) {
    logger.error({
      msg: '[partner] No PARTNER_INBOX or SMTP_USER configured to receive partner applications.',
    });
    return { success: false, error: 'Misconfigured email environment variables.' };
  }

  /** Renders a table row only when the value is non-empty. */
  const row = (label: string, value: string) =>
    value
      ? `<tr><td style="padding: 8px 0; font-weight: 600; color: #4a5568; width: 35%; vertical-align: top;">${label}</td><td style="padding: 8px 0; color: #2d3748;">${value}</td></tr>`
      : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background: #4C6EF5; padding: 24px;">
        <h2 style="color: #ffffff; margin: 0;">New Partner Application</h2>
      </div>
      <div style="padding: 32px 24px;">
        <p style="color: #333; font-size: 16px; margin-top: 0;">
          A new partner-program application has been submitted for <strong>${appName}</strong>:
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 24px;">
          <tbody>
            ${row('Name', escapeHtml(data.name))}
            ${row('Email', `<a href="mailto:${encodeURIComponent(data.email)}" style="color: #4C6EF5;">${escapeHtml(data.email)}</a>`)}
            ${row('Company', escapeHtml(data.company ?? ''))}
            ${row('Facilities in network', escapeHtml(data.network ?? ''))}
            ${row('Message', escapeHtml(data.message ?? ''))}
          </tbody>
        </table>
      </div>
    </div>
  `;

  try {
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to,
        replyTo: data.email,
        subject: `New partner application — ${data.name}`,
        html,
      },
      'partner_application',
    );
    logger.info({
      msg: '[partner] Partner application email sent',
      messageId: info.messageId,
      to: maskEmail(to),
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ msg: '[partner] Error sending partner application email', err: error });
    return { success: false, error };
  }
}

/** Resolve the server-side base URL using the same precedence as the other emails. */
function reminderBaseUrl(): string {
  return (
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://staging-lms.theraptly.com'
  );
}

/**
 * Stage 1 — Initial launch. Sent when a course is assigned (the in-app
 * COURSE_ASSIGNED notification is kept; this is the accompanying email).
 * Friendly tone, surfaces the due date, links to the worker trainings page.
 */
export async function sendCourseLaunchEmail(
  to: string,
  userName: string,
  courseName: string,
  orgName: string,
  dueAt: Date | string | null,
): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  if (!to) {
    logger.warn({ msg: '[email] Course launch email skipped — missing recipient' });
    return { success: false, error: 'Missing recipient email' };
  }

  const appName = 'Theraptly';
  const trainingsLink = `${reminderBaseUrl()}/worker/trainings`;
  const formattedDue = formatDueDate(dueAt);

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #4C6EF5; font-size: 28px; margin: 0;">📋 New Required Training Assigned</h1>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${escapeHtml(userName)}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                <strong>${escapeHtml(orgName)}</strong> has assigned you a new required training course:
            </p>
            <div style="background: #f7fafc; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
                <h3 style="margin: 0; color: #2D3748; font-size: 20px;">${escapeHtml(courseName)}</h3>
                ${
                  formattedDue
                    ? `<p style="margin: 12px 0 0 0; color: #4a5568; font-size: 15px;">Due by <strong>${escapeHtml(formattedDue)}</strong></p>`
                    : ''
                }
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Please review the details and log in to begin the course.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${trainingsLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Log In to Begin</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                If you have questions, please contact your administrator.
            </p>
        </div>
    `;

  try {
    const info = await sendMailTracked(
      {
        from: `"${appName}" <${user}>`,
        to,
        subject: `📋 New Required Training Assigned: ${courseName}`,
        html,
      },
      'course_launch',
    );
    logger.info({
      msg: '[email] Course launch email sent',
      messageId: info.messageId,
      to: maskEmail(to),
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({
      msg: '[email] Failed to send course launch email',
      err: error,
      to: maskEmail(to),
    });
    return { success: false, error };
  }
}

/** Deadline reminder stages (CSV stages 2–4). */
export type DeadlineReminderStage = 'friendly' | 'urgent' | 'day_of';

/**
 * Stages 2–4 — Deadline reminders to the worker. A single template whose copy
 * varies by `stage` (friendly / urgent / day-of). Links to the worker
 * trainings page.
 */
export async function sendDeadlineReminderEmail(
  to: string,
  userName: string,
  courseName: string,
  dueAt: Date | string | null,
  stage: DeadlineReminderStage,
): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  if (!to) {
    logger.warn({ msg: '[email] Deadline reminder email skipped — missing recipient', stage });
    return { success: false, error: 'Missing recipient email' };
  }

  const appName = 'Theraptly';
  const trainingsLink = `${reminderBaseUrl()}/worker/trainings`;
  const formattedDue = formatDueDate(dueAt);

  const copy: Record<
    DeadlineReminderStage,
    { subject: string; heading: string; headingColor: string; message: string }
  > = {
    friendly: {
      subject: `⏳ Upcoming Deadline: ${courseName}`,
      heading: '⏳ Upcoming Deadline',
      headingColor: '#DD6B20',
      message:
        'Please complete this training within the next two weeks to stay current with your compliance requirements.',
    },
    urgent: {
      subject: `⚠️ Action Required: ${courseName} expires in 3 days`,
      heading: '⚠️ Action Required',
      headingColor: '#E53E3E',
      message:
        'This training expires in 3 days. Please finish the modules immediately to prevent a gap in compliance.',
    },
    day_of: {
      subject: `🚨 Final Notice: ${courseName} is due today`,
      heading: '🚨 Final Notice',
      headingColor: '#E53E3E',
      message: 'This training is due today. Please complete it before midnight tonight.',
    },
  };

  const { subject, heading, headingColor, message } = copy[stage];

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: ${headingColor}; font-size: 28px; margin: 0;">${heading}</h1>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${escapeHtml(userName)}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                This is a reminder about your assigned training:
            </p>
            <div style="background: #f7fafc; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
                <h3 style="margin: 0; color: #2D3748; font-size: 20px;">${escapeHtml(courseName)}</h3>
                ${
                  formattedDue
                    ? `<p style="margin: 12px 0 0 0; color: #4a5568; font-size: 15px;">Due by <strong>${escapeHtml(formattedDue)}</strong></p>`
                    : ''
                }
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                ${escapeHtml(message)}
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${trainingsLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Complete Training</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                If you have questions, please contact your administrator.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      subject,
      html,
    });
    logger.info({
      msg: '[email] Deadline reminder email sent',
      messageId: info.messageId,
      to: maskEmail(to),
      stage,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({
      msg: '[email] Failed to send deadline reminder email',
      err: error,
      to: maskEmail(to),
      stage,
    });
    return { success: false, error };
  }
}

/**
 * Stage 5 (worker copy) — Overdue notice. Warning styling; the worker must
 * complete the training immediately. (The admin/manager side of stage 5 is
 * handled by sendEscalationEmail.)
 */
export async function sendDeadlineOverdueWorkerEmail(
  to: string,
  userName: string,
  courseName: string,
  dueAt: Date | string | null,
  daysOverdue: number,
): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  if (!to) {
    logger.warn({ msg: '[email] Overdue worker email skipped — missing recipient' });
    return { success: false, error: 'Missing recipient email' };
  }

  const appName = 'Theraptly';
  const trainingsLink = `${reminderBaseUrl()}/worker/trainings`;
  const formattedDue = formatDueDate(dueAt);

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h2 style="color: #E53E3E;">🛑 OVERDUE: ${escapeHtml(courseName)} Training</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${escapeHtml(userName)}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Your required training is now overdue and your compliance is at risk:
            </p>
            <div style="background: #FFF5F5; border-left: 4px solid #E53E3E; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 4px 0;"><strong>Course:</strong> ${escapeHtml(courseName)}</p>
                ${
                  formattedDue
                    ? `<p style="margin: 4px 0;"><strong>Due Date:</strong> ${escapeHtml(formattedDue)}</p>`
                    : ''
                }
                <p style="margin: 4px 0;"><strong>Days Overdue:</strong> ${escapeHtml(daysOverdue)}</p>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Please complete this training immediately to return to compliance.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${trainingsLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Complete Training Now</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                If you have questions, please contact your administrator.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      subject: `🛑 OVERDUE: ${courseName} Training`,
      html,
    });
    logger.info({
      msg: '[email] Overdue worker email sent',
      messageId: info.messageId,
      to: maskEmail(to),
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({
      msg: '[email] Failed to send overdue worker email',
      err: error,
      to: maskEmail(to),
    });
    return { success: false, error };
  }
}

/**
 * Stages 5 & 6 — Escalation to the worker's manager (or org admins). Warning
 * styling mirroring sendQuizLockedEmail. `actionLink` may be absolute or a
 * relative path; relative paths are resolved against the configured base URL.
 */
export async function sendEscalationEmail(
  to: string,
  recipientName: string,
  workerName: string,
  courseName: string,
  dueAt: Date | string | null,
  daysOverdue: number,
  stageLabel: string,
  actionLink: string,
): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  if (!to) {
    logger.warn({ msg: '[email] Escalation email skipped — missing recipient' });
    return { success: false, error: 'Missing recipient email' };
  }

  const appName = 'Theraptly';
  const formattedDue = formatDueDate(dueAt);
  const resolvedActionLink = /^https?:\/\//i.test(actionLink)
    ? actionLink
    : `${reminderBaseUrl()}${actionLink.startsWith('/') ? '' : '/'}${actionLink}`;

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #E53E3E;">📉 Compliance Alert: Action Required</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${escapeHtml(recipientName)}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                A worker in your organization has an overdue required training that needs your attention:
            </p>
            <div style="background: #FFF5F5; border-left: 4px solid #E53E3E; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 4px 0;"><strong>Worker:</strong> ${escapeHtml(workerName)}</p>
                <p style="margin: 4px 0;"><strong>Course:</strong> ${escapeHtml(courseName)}</p>
                ${
                  formattedDue
                    ? `<p style="margin: 4px 0;"><strong>Due Date:</strong> ${escapeHtml(formattedDue)}</p>`
                    : ''
                }
                <p style="margin: 4px 0;"><strong>Days Overdue:</strong> ${escapeHtml(daysOverdue)}</p>
                <p style="margin: 4px 0;"><strong>Escalation Stage:</strong> ${escapeHtml(stageLabel)}</p>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Please intervene with a manual follow-up, re-assign the training, or take the
                appropriate compliance action for this worker.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${resolvedActionLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Review Compliance</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                This is an automated notification from ${appName}.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      subject: `📉 Compliance Alert: Action required for ${workerName}`,
      html,
    });
    logger.info({
      msg: '[email] Escalation email sent',
      messageId: info.messageId,
      to: maskEmail(to),
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({
      msg: '[email] Failed to send escalation email',
      err: error,
      to: maskEmail(to),
    });
    return { success: false, error };
  }
}

/**
 * Admin pre-deadline reminder (Issue #8) — a heads-up to the escalation manager
 * that a worker's training deadline is approaching. Unlike {@link sendEscalationEmail},
 * this fires BEFORE the deadline, so the copy is a proactive nudge, never an
 * overdue alert.
 */
export async function sendPreDeadlineEscalationEmail(
  to: string,
  recipientName: string,
  workerName: string,
  courseName: string,
  dueAt: Date | string | null,
  actionLink: string,
): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  if (!to) {
    logger.warn({ msg: '[email] Pre-deadline escalation email skipped — missing recipient' });
    return { success: false, error: 'Missing recipient email' };
  }

  const appName = 'Theraptly';
  const formattedDue = formatDueDate(dueAt);
  const resolvedActionLink = /^https?:\/\//i.test(actionLink)
    ? actionLink
    : `${reminderBaseUrl()}${actionLink.startsWith('/') ? '' : '/'}${actionLink}`;

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #DD6B20;">⏳ Upcoming Deadline: Worker Training</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${escapeHtml(recipientName)}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                A worker in your organization has a required training with an approaching deadline:
            </p>
            <div style="background: #FFFAF0; border-left: 4px solid #DD6B20; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 4px 0;"><strong>Worker:</strong> ${escapeHtml(workerName)}</p>
                <p style="margin: 4px 0;"><strong>Course:</strong> ${escapeHtml(courseName)}</p>
                ${
                  formattedDue
                    ? `<p style="margin: 4px 0;"><strong>Due Date:</strong> ${escapeHtml(formattedDue)}</p>`
                    : ''
                }
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Please follow up with this worker so the training is completed before the deadline.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${resolvedActionLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Review Compliance</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                This is an automated notification from ${appName}.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      subject: `⏳ Upcoming deadline: ${workerName}'s ${courseName} training`,
      html,
    });
    logger.info({
      msg: '[email] Pre-deadline escalation email sent',
      messageId: info.messageId,
      to: maskEmail(to),
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({
      msg: '[email] Failed to send pre-deadline escalation email',
      err: error,
      to: maskEmail(to),
    });
    return { success: false, error };
  }
}

/**
 * Track B — Retake reminder. Nudges a worker who failed the quiz but still has
 * attempts remaining to retake it. Links to the worker trainings page.
 */
export async function sendRetakeReminderEmail(
  to: string,
  userName: string,
  courseName: string,
  attemptsRemaining: number,
): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  if (!to) {
    logger.warn({ msg: '[email] Retake reminder email skipped — missing recipient' });
    return { success: false, error: 'Missing recipient email' };
  }

  const appName = 'Theraptly';
  const trainingsLink = `${reminderBaseUrl()}/worker/trainings`;

  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #DD6B20; font-size: 28px; margin: 0;">🔁 Retake Available</h1>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${escapeHtml(userName)}</strong>,
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                You did not pass the quiz for your assigned training, but you still have attempts remaining:
            </p>
            <div style="background: #f7fafc; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
                <h3 style="margin: 0; color: #2D3748; font-size: 20px;">${escapeHtml(courseName)}</h3>
                <p style="margin: 12px 0 0 0; color: #4a5568; font-size: 15px;">Attempts Remaining: <strong>${escapeHtml(attemptsRemaining)}</strong></p>
            </div>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Please log in and retake the quiz to complete your training and stay compliant.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="${trainingsLink}" style="display: inline-block; background-color: #4C6EF5; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Retake the Quiz</a>
            </div>
            <p style="color: #718096; font-size: 12px; margin-top: 32px; text-align: center;">
                If you have questions, please contact your administrator.
            </p>
        </div>
    `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${user}>`,
      to,
      subject: `🔁 Retake Available: ${courseName}`,
      html,
    });
    logger.info({
      msg: '[email] Retake reminder email sent',
      messageId: info.messageId,
      to: maskEmail(to),
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error({
      msg: '[email] Failed to send retake reminder email',
      err: error,
      to: maskEmail(to),
    });
    return { success: false, error };
  }
}

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
    const info = await sendMailTracked(
      {
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
      },
      'activity_report',
    );
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
    const info = await sendMailTracked(
      {
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
      },
      'auditor_pack',
    );
    logger.info({ msg: '[email] Auditor pack PDF sent', messageId: info.messageId, orgName });
    return { success: true };
  } catch (error) {
    logger.error({ msg: '[email] Failed to send auditor pack PDF', err: error });
    return { success: false, error };
  }
}
