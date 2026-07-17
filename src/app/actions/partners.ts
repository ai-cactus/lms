'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { sendPartnerApplicationEmail } from '@/lib/email';
import { logger, maskEmail } from '@/lib/logger';
import { verifyCaptcha } from '@/lib/captcha';

const partnerFormSchema = z.object({
  name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  company: z.string().optional(),
  network: z.string().optional(),
  message: z.string().optional(),
});

export type PartnerFormData = z.infer<typeof partnerFormSchema>;

export async function submitPartnerApplication(prevState: unknown, formData: FormData) {
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
      logger.warn({ msg: '[partner] Partner application captcha verification failed', ip });
      return { success: false, error: 'Captcha verification failed. Please try again.' };
    }

    const data = {
      name: formData.get('name'),
      email: formData.get('email'),
      company: formData.get('company') || undefined,
      network: formData.get('network') || undefined,
      message: formData.get('message') || undefined,
    };

    const parsed = partnerFormSchema.safeParse(data);

    if (!parsed.success) {
      logger.warn({ msg: '[partner] Partner application validation failed' });
      return {
        success: false,
        error: 'Please add your name and a valid email.',
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    const emailRes = await sendPartnerApplicationEmail(parsed.data);

    if (!emailRes.success) {
      logger.error({ msg: '[partner] Failed to send partner application email' });
      return {
        success: false,
        error: 'Failed to submit your application at this time. Please try again later.',
      };
    }

    logger.info({
      msg: '[partner] Partner application submitted',
      email: maskEmail(parsed.data.email),
    });
    return { success: true, message: 'Your partner application has been submitted successfully.' };
  } catch (error) {
    logger.error({ msg: '[partner] Error in submitPartnerApplication', err: error });
    return { success: false, error: 'An unexpected error occurred. Please try again later.' };
  }
}
