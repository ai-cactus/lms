'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mail, MailCheck } from 'lucide-react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { sendPasswordResetLink } from '@/app/actions/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');

  const validateForm = () => {
    if (!email.trim()) {
      setFieldError('Email is required');
      return false;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setFieldError('Please enter a valid email address');
      return false;
    }
    setFieldError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      const result = await sendPasswordResetLink(email);
      if (result.success) {
        setIsSubmitted(true);
      } else {
        setError(result.error || 'Failed to send reset link');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
          {!isSubmitted && (
            <div className="w-full text-left flex flex-col gap-1">
              <h1 className="text-headline-3 font-semibold font-headline leading-8 text-text-bold">
                Reset your password
              </h1>
              <p className="text-base leading-6 font-text text-text-neutral">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>
            </div>
          )}
        </div>
        {!isSubmitted ? (
          <>
            <form onSubmit={handleSubmit} className="flex flex-col gap-8">
              <div className="flex flex-col gap-5">
                <Field label="Email" error={fieldError || error}>
                  <Input
                    type="email"
                    name="email"
                    placeholder="Enter your email address"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldError) setFieldError('');
                    }}
                    autoComplete="email"
                    startIcon={<Mail aria-hidden="true" />}
                  />
                </Field>
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={loading}
                disabled={!email.trim()}
              >
                Send Reset Link
              </Button>
            </form>
            <p className="text-sm text-text-title font-medium leading-5 text-center">
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Back to Login
              </Link>
            </p>
          </>
        ) : (
          <div className="flex w-full flex-col items-center gap-4 rounded-xl border border-border bg-background-secondary p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
              <MailCheck className="size-6" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Check your email</h3>
            <p className="text-sm leading-relaxed text-text-secondary">
              If an account exists for {email}, we have sent a password reset link.
            </p>
            <Button variant="outline" className="mt-2 w-full" onClick={() => setIsSubmitted(false)}>
              Try another email
            </Button>
            <div className="mt-2 flex w-full justify-center">
              <Link href="/login" className="text-sm font-semibold text-primary hover:underline">
                Back to Login
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
