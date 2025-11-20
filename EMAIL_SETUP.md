# Email Notification Setup Guide

## Overview
The Theraptly LMS uses Resend for sending email notifications to workers. This guide explains how to set up and configure email notifications.

## Required Environment Variables

Add these to your `.env.local` file:

```env
# Resend Email Service
RESEND_API_KEY=your_resend_api_key

# Application URL (for email links)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Cron Job Secret (for securing cron endpoints)
CRON_SECRET=your_random_secret_string
```

## Setting Up Resend

1. **Create a Resend Account**
   - Go to [resend.com](https://resend.com)
   - Sign up for a free account
   - Free tier includes 100 emails/day, 3,000 emails/month

2. **Get Your API Key**
   - Navigate to API Keys in your Resend dashboard
   - Click "Create API Key"
   - Copy the key and add it to your `.env.local` as `RESEND_API_KEY`

3. **Configure Domain (Optional)**
   - For production, add your custom domain in Resend
   - Verify DNS records
   - Update the "from" address in `src/lib/email.ts`

## Email Templates

The system includes two email templates:

### 1. Worker Welcome Email
**File**: `src/emails/worker-welcome.tsx`

Sent when a new worker is created. Includes:
- Welcome message
- Temporary password
- List of assigned courses
- Login link

### 2. Training Reminder Email
**File**: `src/emails/training-reminder.tsx`

Sent as training deadlines approach. Includes:
- Course title
- Deadline date
- Days remaining (or overdue)
- Urgency indicators (color-coded)
- Login link

## Automated Reminders

### Cron Job Setup

The system sends automatic reminders at these intervals:
- **7 days before deadline**: First reminder
- **3 days before deadline**: Second reminder
- **1 day before deadline**: Final reminder
- **Daily after overdue**: Overdue notifications

### Setting Up Cron Jobs

#### Option 1: Vercel Cron (Recommended for Vercel deployments)

Create `vercel.json` in your project root:

```json
{
  "crons": [
    {
      "path": "/api/cron/send-reminders",
      "schedule": "0 9 * * *"
    }
  ]
}
```

This runs daily at 9:00 AM UTC.

#### Option 2: External Cron Service (e.g., cron-job.org)

1. Generate a secure CRON_SECRET:
   ```bash
   openssl rand -base64 32
   ```

2. Add to `.env.local`:
   ```env
   CRON_SECRET=your_generated_secret
   ```

3. Set up a cron job to call:
   ```
   POST https://yourdomain.com/api/cron/send-reminders
   Authorization: Bearer your_generated_secret
   ```

4. Schedule: Daily at 9:00 AM

## Testing Emails Locally

### Using Resend Test Mode

1. In development, Resend automatically uses test mode
2. Emails won't actually be sent but will appear in your Resend dashboard
3. Check the "Emails" tab in Resend to see test emails

### Manual Testing

You can test email sending by calling the functions directly:

```typescript
import { sendWorkerWelcomeEmail } from "@/lib/email";

await sendWorkerWelcomeEmail({
  to: "test@example.com",
  workerName: "Test Worker",
  organizationName: "Test Org",
  tempPassword: "temp123",
  assignedCourses: ["Course 1", "Course 2"],
});
```

## Email Sending Functions

### `sendWorkerWelcomeEmail(params)`

Sends welcome email to new workers.

**Parameters:**
- `to`: Worker's email address
- `workerName`: Worker's full name
- `organizationName`: Organization name
- `tempPassword`: Temporary password
- `assignedCourses`: Array of course titles

### `sendTrainingReminderEmail(params)`

Sends training reminder to a worker.

**Parameters:**
- `to`: Worker's email address
- `workerName`: Worker's full name
- `courseTitle`: Course title
- `deadline`: Deadline date

### `sendBulkTrainingReminders(reminders)`

Sends multiple reminders in batch.

**Parameters:**
- `reminders`: Array of reminder parameters

**Returns:**
```typescript
{
  total: number,
  successful: number,
  failed: number,
  results: Array
}
```

## Production Considerations

1. **Domain Verification**
   - Verify your domain in Resend for better deliverability
   - Use a custom "from" address (e.g., `noreply@yourdomain.com`)

2. **Rate Limits**
   - Free tier: 100 emails/day, 3,000/month
   - Paid plans available for higher volumes
   - Implement retry logic for failed sends

3. **Monitoring**
   - Check Resend dashboard for delivery rates
   - Monitor bounce and complaint rates
   - Set up webhooks for delivery status

4. **Security**
   - Keep RESEND_API_KEY secret
   - Use CRON_SECRET to protect cron endpoints
   - Validate email addresses before sending

## Troubleshooting

### Emails Not Sending

1. Check RESEND_API_KEY is set correctly
2. Verify API key is active in Resend dashboard
3. Check console logs for error messages
4. Ensure email addresses are valid

### Emails Going to Spam

1. Verify your domain in Resend
2. Set up SPF, DKIM, and DMARC records
3. Use a professional "from" address
4. Avoid spam trigger words in subject lines

### Cron Jobs Not Running

1. Verify CRON_SECRET matches in both places
2. Check cron job schedule is correct
3. Test endpoint manually with curl:
   ```bash
   curl -X POST https://yourdomain.com/api/cron/send-reminders \
     -H "Authorization: Bearer your_cron_secret"
   ```

## Support

For Resend-specific issues:
- Documentation: https://resend.com/docs
- Support: support@resend.com

For LMS email issues:
- Check application logs
- Review email template code
- Test with different email providers
