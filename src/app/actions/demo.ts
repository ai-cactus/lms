'use server';

import { z } from 'zod';
import { sendDemoRequestEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

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

    // Call email sender
    const emailRes = await sendDemoRequestEmail(parsed.data);

    if (!emailRes.success) {
      logger.error({ msg: 'Failed to send demo request email', detail: emailRes.error });
      return {
        success: false,
        error: 'Failed to submit your request at this time. Please try again later.',
      };
    }

    return { success: true, message: 'Your demo request has been submitted successfully.' };
  } catch (error) {
    logger.error({ msg: 'Error in submitDemoRequest', error });
    return { success: false, error: 'An unexpected error occurred. Please try again later.' };
  }
}
