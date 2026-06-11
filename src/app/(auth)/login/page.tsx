'use client';

import React, { useState, useActionState, useEffect, Suspense } from 'react';
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
import { AuthShell } from '@/components/auth/AuthShell';
import { authenticate } from '@/app/actions/auth';
import { signIn } from 'next-auth/react';
import { logger } from '@/lib/logger';

function LoginForm() {
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

    logger.info({ msg: '[Login Client] Submit clicked! Current form data:', data: formData });
    const isValid = validateForm();
    logger.info({ msg: '[Login Client] Validation result:', data: { isValid, errors } });
    if (!isValid) return;

    setErrors({});
    // Construct FormData manually
    const form = new FormData();
    form.append('email', formData.email);
    form.append('password', formData.password);

    logger.info({ msg: '[Login Client] Dispatching form to authenticate action...' });
    React.startTransition(() => {
      dispatch(form);
    });
  };

  useEffect(() => {
    logger.info({ msg: '[Login Client] Action state changed:', data: state });
    if (state?.redirect) {
      // Auto-route to the correct login page for their role
      router.push(state.redirect);
    } else if (state?.success) {
      logger.info({ msg: '[Login Client] Success! Redirecting to /dashboard' });
      router.push('/dashboard');
    } else if (state?.error) {
      logger.error({ msg: '[Login Client] Error returned from action:', err: state.error });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional sync of server error to local state for UX control
      setErrors((prev) => ({ ...prev, email: state.error }));
    }
  }, [state, router]);

  return (
    <AuthShell>
      <Logo size="md" />

      <div className="w-full text-left">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Log in to your account</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Log in to your workspace and get back to what matters.
        </p>
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

      {inactiveReason === 'inactive' && (
        <Alert variant="warning" className="w-full" title="Session Expired">
          You were logged out due to inactivity. Please log in again.
        </Alert>
      )}

      <Button
        variant="secondary"
        type="button"
        className="w-full gap-3 rounded-full"
        onClick={handleMicrosoftLogin}
        loading={isMicrosoftLoading}
      >
        <Image src="/icons/microsoft.svg" alt="Microsoft" width={20} height={20} />
        <span>Log In with Microsoft</span>
      </Button>

      <div className="flex w-full items-center gap-3 text-xs text-text-tertiary">
        <span className="h-px flex-1 bg-border" />
        <span>or continue with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
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

        <div className="-mt-2 flex w-full justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Forgot your password?
          </Link>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={isPending}
          disabled={!formData.email || !formData.password}
        >
          Log in
        </Button>
      </form>

      <p className="text-sm text-text-secondary">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Sign Up
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <Logo size="md" />
          <p className="text-sm text-text-secondary">Loading...</p>
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
