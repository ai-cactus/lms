'use client';

import React, { useState, useActionState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock } from 'lucide-react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert } from '@/components/ui/alert';
import { authenticate } from '@/app/actions/auth';
import { signIn } from 'next-auth/react';
import { logger, maskEmail } from '@/lib/logger';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const joined = searchParams.get('joined');
  const oauthError = searchParams.get('error');

  const [inactiveReason] = React.useState<string | null>(
    typeof window !== 'undefined'
      ? (sessionStorage.getItem('logout_reason') ?? searchParams.get('reason'))
      : searchParams.get('reason'),
  );

  // Clear the sessionStorage flag immediately so it doesn't persist on refresh
  useEffect(() => {
    try {
      if (sessionStorage.getItem('logout_reason')) {
        sessionStorage.removeItem('logout_reason');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const [state, dispatch, isPending] = useActionState(authenticate, undefined);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  });
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isMicrosoftLoading, setIsMicrosoftLoading] = useState(false);

  const handleMicrosoftLogin = () => {
    setIsMicrosoftLoading(true);
    signIn('microsoft-entra-id', { callbackUrl: '/dashboard' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name as keyof typeof errors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validateForm = () => {
    const newErrors: typeof errors = {};

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    // Login validates only that a password was entered — never enforce the
    // signup-strength minimum here, or existing users whose password predates
    // the current policy (and is shorter than PASSWORD_MIN_LENGTH) would be
    // blocked from submitting valid credentials. The server verifies via bcrypt.
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    logger.debug({
      msg: '[login] Submit clicked',
      data: { email: maskEmail(formData.email), rememberMe: formData.rememberMe },
    });
    const isValid = validateForm();
    logger.debug({ msg: '[login] Validation result', data: { isValid, errors } });
    if (!isValid) return;

    setErrors({});
    const form = new FormData();
    form.append('email', formData.email);
    form.append('password', formData.password);

    logger.debug({ msg: '[login] Dispatching form to authenticate action' });
    React.startTransition(() => {
      dispatch(form);
    });
  };

  useEffect(() => {
    logger.debug({
      msg: '[login] Action state changed',
      data: { success: state?.success, redirect: state?.redirect, hasError: Boolean(state?.error) },
    });
    if (state?.redirect) {
      // Auto-route to the correct login page for their role
      router.push(state.redirect);
    } else if (state?.success) {
      logger.debug({ msg: '[login] Success, redirecting to /dashboard' });
      router.push('/dashboard');
    } else if (state?.error) {
      logger.error({ msg: '[login] Error returned from action', err: state.error });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional sync of server error to local state for UX control
      setErrors((prev) => ({ ...prev, email: state.error }));
    }
  }, [state, router]);

  return (
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
          <div className="w-full text-left flex flex-col gap-1">
            <h1 className="text-headline-3 font-semibold font-headline leading-8 text-text-bold">
              Log in to your account
            </h1>
            <p className="text-base leading-6 font-text text-text-neutral">
              Log in to your workspace and get back to what matters.
            </p>
          </div>
        </div>
        {joined && (
          <Alert variant="success" className="w-full" title="Account created successfully!">
            Please log in.
          </Alert>
        )}
        {searchParams.get('verified') && (
          <Alert variant="success" className="w-full" title="Email verified successfully!">
            Please log in to continue to your account.
          </Alert>
        )}
        {oauthError === 'AccessDenied' && (
          <Alert variant="error" className="w-full" title="Access Denied">
            You do not have authorization to log in with this role.
          </Alert>
        )}
        {oauthError === 'AccessRevoked' && (
          <Alert variant="error" className="w-full" title="Access Removed">
            Your access to this organization has been removed. Please contact your administrator.
          </Alert>
        )}
        {inactiveReason === 'inactive' && (
          <Alert variant="warning" className="w-full" title="Session Expired">
            You were logged out due to inactivity. Please log in again.
          </Alert>
        )}
        <div className="flex flex-col gap-9">
          <Button
            type="button"
            variant="secondary"
            className="w-full gap-3 rounded-full"
            onClick={handleMicrosoftLogin}
            loading={isMicrosoftLoading}
            disabled={isMicrosoftLoading}
          >
            <Image src="/icons/microsoft.svg" alt="Microsoft" width={20} height={20} />
            <span className="font-semibold text-text-title leading-5 text-sm font-text">
              Log In with Microsoft
            </span>
          </Button>
          <div className="flex w-full items-center gap-3">
            <span className="h-px flex-1 bg-tertiary" />
            <span className="text-xs text-text-neutral font-text">or continue with email</span>
            <span className="h-px flex-1 bg-tertiary" />
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <div className="flex flex-col gap-5">
              <Field label="Email" error={errors.email}>
                <Input
                  type="email"
                  name="email"
                  placeholder="Enter your email address"
                  value={formData.email}
                  onChange={handleChange}
                  autoComplete="email"
                  startIcon={<Mail aria-hidden="true" />}
                />
              </Field>
              <Field label="Password" error={errors.password}>
                <PasswordInput
                  name="password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="current-password"
                  startIcon={<Lock aria-hidden="true" />}
                />
              </Field>
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Forgot your password?
                </Link>
              </div>
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={isPending}
              disabled={!formData.email || !formData.password}
            >
              Log In
            </Button>
          </form>
        </div>
        <p className="text-sm text-text-title font-medium leading-5 text-center">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-semibold text-primary hover:underline">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}
