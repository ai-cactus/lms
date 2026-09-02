'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { sendDemoRequestEmail } from '@/lib/email';
import { logger } from '@/lib/logger';
import { verifyCaptcha } from '@/lib/captcha';
import { captureServer } from '@/lib/analytics/server';

const demoFormSchema = z.object({
  fullName: z.string().min(1, 'Full Name is required'),
  email: z.string().email('Invalid email address'),
  organizationName: z.string().min(1, 'Organization Name is required'),
  role: z.string().min(1, 'Role is required'),
  helpUs: z.string().min(1, 'This field is required'),
  demoTime: z.string().min(1, 'Preferred Demo Time is required'),
});

export type DemoFormData = z.infer<typeof demoFormSchema>;

export async function submitDemoRequest(prevState: unknown, formData: FormData) {
  try {
    // Bot verification — no-op unless hCaptcha is enabled (see src/lib/captcha.ts).
    const headersList = await headers();
    const ip =
      headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headersList.get('x-real-ip') ??
      'unknown';
    const captchaToken = (formData.get('captchaToken') as string | null) ?? undefined;
    const captchaValid = await verifyCaptcha(captchaToken, ip);
    if (!captchaValid) {
      logger.warn({ msg: '[demo] Demo request captcha verification failed', ip });
      return { success: false, error: 'Captcha verification failed. Please try again.' };
    }

    const data = {
      fullName: formData.get('fullName'),
      email: formData.get('email'),
      organizationName: formData.get('organizationName'),
      role: formData.get('role'),
      helpUs: formData.get('helpUs'),
      demoTime: formData.get('demoTime'),
      termsAgreed: formData.get('termsAgreed') === 'on',
    };

    if (!data.termsAgreed) {
      return {
        success: false,
        error: 'You must agree to the Terms & Conditions and Privacy Policy.',
      };
    }

    const parsed = demoFormSchema.safeParse(data);

    if (!parsed.success) {
      return {
        success: false,
        error: 'Please fill in all required fields correctly.',
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    const emailRes = await sendDemoRequestEmail(parsed.data);

    if (!emailRes.success) {
      logger.error({ msg: 'Failed to send demo request email', detail: emailRes.error });
      return {
        success: false,
        error: 'Failed to submit your request at this time. Please try again later.',
      };
    }

    // No session and no User row — a demo request is anonymous. The org NAME is
    // never sent (it identifies the prospect); only whether they wrote a message
    // and, if given, a bucketed size. Attributed to a stable synthetic id: this
    // is a marketing conversion, not a person, so it must not create a profile.
    captureServer(
      'demo_requested',
      () => ({
        organization_size_band: null,
        has_message: Boolean(String(data.helpUs ?? '').trim()),
      }),
      { distinctId: 'anonymous-demo-request' },
    );

    return { success: true, message: 'Your demo request has been submitted successfully.' };
  } catch (error) {
    logger.error({ msg: 'Error in submitDemoRequest', error });
    return { success: false, error: 'An unexpected error occurred. Please try again later.' };
  }
}
