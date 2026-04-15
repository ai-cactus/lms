'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import styles from './page.module.css';

import { Input, Button, Checkbox } from '@/components/ui';
import DatePicker from '@/components/ui/DatePicker';
import { submitDemoRequest } from '@/app/actions/demo';
import FeatureSection from '@/app/_components/FeatureSection';
import InspectorsSection from '@/app/_components/InspectorsSection';
import Footer from '@/app/_components/Footer';

const formSchema = z.object({
  fullName: z.string().min(1, 'Full Name is required'),
  email: z.string().email('Valid email is required'),
  organizationName: z.string().min(1, 'Organization Name is required'),
  role: z.string().min(1, 'Role is required'),
  helpUs: z.string().min(1, 'Please let us know how we can help'),
  demoTime: z.string().min(1, 'Please select a preferred demo time'),
  termsAgreed: z.boolean().refine((val) => val === true, {
    message: 'You must agree to the Terms & Conditions and Privacy Policy',
  }),
});

type FormValues = z.infer<typeof formSchema>;

export default function RequestDemoPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
  } | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: '',
      email: '',
      organizationName: '',
      role: '',
      helpUs: '',
      demoTime: '',
      termsAgreed: false,
    },
  });

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (typeof value === 'boolean') {
          if (value) formData.append(key, 'on');
        } else {
          formData.append(key, String(value));
        }
      });

      const res = await submitDemoRequest(null, formData);
      if (res.success) {
        setSubmitResult({ success: true, message: res.message });
      } else {
        setSubmitResult({ success: false, error: res.error });
      }
    } catch {
      setSubmitResult({ success: false, error: 'An unexpected error occurred.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.pageWrapper}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <Link href="/">
            <Image src="/images/logo.svg" alt="Theraptly Logo" width={140} height={32} priority />
          </Link>
        </div>

        <nav className={styles.nav}>
          <Link href="/#features" className={styles.navLink}>
            Features
          </Link>
          <Link href="/#blog" className={styles.navLink}>
            Blog
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginLeft: 2, opacity: 0.6 }}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Link>
        </nav>

        <div className={styles.headerActions}>
          <Link href="/login" className={styles.btnSignIn}>
            Sign in
          </Link>
          <Link href="/request-demo" className={styles.btnDemo}>
            Request a Demo
          </Link>
        </div>
      </header>

      <main className={styles.mainContainer}>
        <div className={styles.leftColumn}>
          <div className={styles.textContent}>
            <div className={styles.eyebrow}>GET A DEMO</div>
            <h1 className={styles.title}>
              Intelligent
              <br />
              Compliance
              <br />
              Training, Built to Scale
            </h1>
            <p className={styles.description}>
              Discover how to turn policies into training, track staff progress, and stay
              audit-ready—all in one platform.
            </p>
          </div>

          <div className={styles.imageContainer}>
            <Image
              src="/images/demo-main-image.png"
              alt="Theraptly LMS System Preview"
              fill
              className={styles.mainImage}
              priority
            />
          </div>
        </div>

        <div className={styles.rightColumn}>
          <div className={styles.formCard}>
            {submitResult?.success ? (
              <div className={styles.successState}>
                <div className={styles.successIcon}>✓</div>
                <h2 className={styles.successTitle}>Request Submitted!</h2>
                <p className={styles.successDescription}>
                  Thank you for reaching out. A member of our team will be in touch shortly to
                  schedule your demo.
                </p>
                <Button
                  onClick={() => (window.location.href = '/')}
                  className={styles.successButton}
                >
                  Return to Home
                </Button>
              </div>
            ) : (
              <>
                <p className={styles.formInstructions}>
                  Tell us about your organization so we can tailor your demo experience.
                </p>

                {submitResult?.error && (
                  <div className={styles.errorMessage}>{submitResult.error}</div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className={styles.requestForm}>
                  <div className={styles.inputGroup}>
                    <Input
                      label="Full Name *"
                      placeholder="Full Name"
                      error={errors.fullName?.message}
                      {...register('fullName')}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <Input
                      label="Work Email *"
                      type="email"
                      placeholder="yourname@company.com"
                      error={errors.email?.message}
                      {...register('email')}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <Input
                      label="Organization Name *"
                      placeholder="e.g. CarePoint Health Services"
                      error={errors.organizationName?.message}
                      {...register('organizationName')}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <Input
                      label="Role *"
                      placeholder="Enter your role"
                      error={errors.role?.message}
                      {...register('role')}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <Input
                      label="How can we help? *"
                      placeholder="What challenges are you trying to solve?"
                      error={errors.helpUs?.message}
                      {...register('helpUs')}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <label className={styles.standardLabel}>Preferred Demo Time *</label>
                    <Controller
                      name="demoTime"
                      control={control}
                      render={({ field }) => (
                        <DatePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Choose your preferred demo slot"
                        />
                      )}
                    />
                    {errors.demoTime && (
                      <span className={styles.errorText}>{errors.demoTime.message}</span>
                    )}
                  </div>

                  <div className={styles.checkboxGroup}>
                    <Controller
                      name="termsAgreed"
                      control={control}
                      render={({ field }) => (
                        <Checkbox
                          id="termsAgreed"
                          label="By checking this box, you agree to Theraptly's Terms & Conditions and Privacy Policy."
                          checked={field.value}
                          onChange={(checked) => field.onChange(checked)}
                        />
                      )}
                    />
                    {errors.termsAgreed && (
                      <span className={styles.errorTextCheckbox}>{errors.termsAgreed.message}</span>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className={styles.submitBtn}
                    variant="primary"
                    fullWidth
                  >
                    {isSubmitting ? 'Submitting...' : 'Request a demo'}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </main>

      <FeatureSection />
      <InspectorsSection />
      <Footer />
    </div>
  );
}
