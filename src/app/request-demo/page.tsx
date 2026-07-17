'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check } from 'lucide-react';

import { Field, HCaptcha } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import DatePicker from '@/components/ui/DatePicker';
import { submitDemoRequest } from '@/app/actions/demo';
import FeatureSection from '@/app/(marketing)/_components/FeatureSection';
import InspectorsSection from '@/app/(marketing)/_components/InspectorsSection';
import Footer from '@/app/(marketing)/_components/Footer';

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
  const [captchaToken, setCaptchaToken] = useState<string>();
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
      if (captchaToken) {
        formData.append('captchaToken', captchaToken);
      }

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
    <div className="flex min-h-screen flex-col bg-[#f8f9fb]">
      <header className="flex h-[70px] items-center justify-between bg-transparent px-5 sm:h-20 sm:px-[5%]">
        <div className="flex flex-1 items-center">
          <Link href="/">
            <Image src="/images/logo.svg" alt="Theraptly Logo" width={140} height={32} priority />
          </Link>
        </div>

        <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
          <Link
            href="/#features"
            className="flex items-center gap-1 text-[15px] font-medium text-foreground transition-colors hover:text-primary"
          >
            Features
          </Link>
        </nav>

        <div className="flex flex-none items-center justify-end gap-2 md:flex-1 md:gap-4">
          <Link
            href="/login"
            className="rounded-[10px] border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground transition-all hover:border-text-tertiary hover:bg-background-secondary sm:px-5 sm:text-sm"
          >
            Sign in
          </Link>
          <Link
            href="/request-demo"
            className="hidden rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 md:inline-block"
          >
            Request a Demo
          </Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1280px] flex-1 grid-cols-1 items-start gap-8 px-5 py-8 sm:px-[5%] md:grid-cols-2 md:gap-20 md:py-10">
        <div className="flex flex-col gap-6 md:gap-10">
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold uppercase tracking-[0.1em] text-[#4c6ef5]">
              GET A DEMO
            </div>
            <h1 className="m-0 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1a1b1e] md:text-5xl lg:text-[56px]">
              Intelligent
              <br className="hidden md:inline" /> Compliance
              <br className="hidden md:inline" /> Training, Built to Scale
            </h1>
            <p className="m-0 max-w-full text-base leading-relaxed text-[#5c5f66] md:max-w-[90%] md:text-lg">
              Discover how to turn policies into training, track staff progress, and stay
              audit-ready—all in one platform.
            </p>
          </div>

          <div className="relative aspect-[1.25] max-h-[300px] w-full overflow-hidden rounded-3xl bg-white shadow-[0px_20px_40px_rgba(0,0,0,0.05)] md:max-h-none">
            <Image
              src="/images/demo-main.jpg"
              alt="Theraptly LMS System Preview"
              fill
              className="object-cover"
              priority
            />
          </div>
        </div>

        <div className="w-full">
          <div className="rounded-2xl border border-[rgba(144,97,249,0.2)] bg-white p-5 shadow-[0_10px_25px_rgba(0,0,0,0.02)] sm:p-6 md:p-10">
            {submitResult?.success ? (
              <div className="flex flex-col items-start justify-start px-5 py-10 text-left">
                <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-[#d3f9d8] text-[#2b8a3e]">
                  <Check className="size-8" strokeWidth={3} aria-hidden="true" />
                </div>
                <h2 className="m-0 mb-4 text-2xl font-bold text-[#1a1b1e]">Request Submitted!</h2>
                <p className="m-0 mb-8 text-base leading-relaxed text-[#5c5f66]">
                  Thank you for reaching out. A member of our team will be in touch shortly to
                  schedule your demo.
                </p>
                <Button onClick={() => (window.location.href = '/')} className="min-w-[200px]">
                  Return to Home
                </Button>
              </div>
            ) : (
              <>
                <p className="m-0 mb-6 text-[15px] font-semibold leading-relaxed text-[#1a1b1e] sm:mb-8 sm:text-base">
                  Tell us about your organization so we can tailor your demo experience.
                </p>

                {submitResult?.error && (
                  <div className="mb-6 rounded-lg border border-[#ffc9c9] bg-[#fff5f5] px-4 py-3 text-sm text-[#e03131]">
                    {submitResult.error}
                  </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
                  <Field label="Full Name *" error={errors.fullName?.message}>
                    <Input placeholder="Full Name" {...register('fullName')} />
                  </Field>

                  <Field label="Work Email *" error={errors.email?.message}>
                    <Input type="email" placeholder="yourname@company.com" {...register('email')} />
                  </Field>

                  <Field label="Organization Name *" error={errors.organizationName?.message}>
                    <Input
                      placeholder="e.g. CarePoint Health Services"
                      {...register('organizationName')}
                    />
                  </Field>

                  <Field label="Role *" error={errors.role?.message}>
                    <Input placeholder="Enter your role" {...register('role')} />
                  </Field>

                  <Field label="How can we help? *" error={errors.helpUs?.message}>
                    <Input
                      placeholder="What challenges are you trying to solve?"
                      {...register('helpUs')}
                    />
                  </Field>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-[#3f4450]">
                      Preferred Demo Time *
                    </label>
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
                      <span className="mt-1 text-xs text-[#f03e3e]">{errors.demoTime.message}</span>
                    )}
                  </div>

                  <div className="my-2">
                    <Controller
                      name="termsAgreed"
                      control={control}
                      render={({ field }) => (
                        <div className="flex items-start gap-2.5">
                          <Checkbox
                            id="termsAgreed"
                            className="mt-0.5"
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                          <label
                            htmlFor="termsAgreed"
                            className="text-sm leading-relaxed text-text-secondary"
                          >
                            By checking this box, you agree to Theraptly&apos;s Terms &amp;
                            Conditions and Privacy Policy.
                          </label>
                        </div>
                      )}
                    />
                    {errors.termsAgreed && (
                      <span className="mt-1 block text-xs text-[#f03e3e]">
                        {errors.termsAgreed.message}
                      </span>
                    )}
                  </div>

                  <HCaptcha
                    onVerify={setCaptchaToken}
                    onExpire={() => setCaptchaToken(undefined)}
                  />

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-4 h-[50px] w-full text-base font-semibold"
                    variant="default"
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
      <InspectorsSection showActions={false} />
      <Footer />
    </div>
  );
}
