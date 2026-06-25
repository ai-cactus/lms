'use client';

import React, { useState, useActionState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { User, Mail, Lock } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthShell } from '@/components/auth/AuthShell';
import { signup, SignupResult } from '@/app/actions/auth';
import { validatePassword } from '@/lib/password-policy';
import PasswordStrengthIndicator from '@/components/ui/PasswordStrengthIndicator';

export default function SignupPage() {
  const router = useRouter();
  const [result, , isPending] = useActionState<SignupResult | undefined, FormData>(
    signup,
    undefined,
  );

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeTerms: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isMicrosoftLoading, setIsMicrosoftLoading] = useState(false);
  const [isFormLoading, setIsFormLoading] = useState(false);

  const handleMicrosoftSignup = () => {
    setIsMicrosoftLoading(true);
    // Calling signIn will route through create-auth-instance.ts logic
    // which creates new users if they don't exist
    signIn('microsoft-entra-id', {
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/signup/role-selection`,
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else {
      const pwCheck = validatePassword(formData.password);
      if (!pwCheck.valid) {
        newErrors.password = pwCheck.errors[0]; // Show first error
      }
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.agreeTerms) {
      newErrors.agreeTerms = 'You must agree to the terms';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;
    setErrors({});

    // Store form data in sessionStorage for role selection page
    sessionStorage.setItem(
      'pendingSignup',
      JSON.stringify({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
      }),
    );

    // Redirect to role selection
    setIsFormLoading(true);
    router.push('/signup/role-selection');
  };

  useEffect(() => {
    if (result) {
      if (result.success) {
        // This shouldn't happen anymore as signup is called from role-selection
        router.push('/verify-email');
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional sync of server error to local state
        setErrors((prev) => ({ ...prev, email: result.error }));
      }
    }
  }, [result, router]);

  return (
    <AuthShell>
      <Logo size="md" />

      <div className="w-full text-left">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Create a new account</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Create a new account to get started.
        </p>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full gap-3 rounded-full"
        onClick={handleMicrosoftSignup}
        loading={isMicrosoftLoading}
        disabled={isMicrosoftLoading}
      >
        <Image src="/icons/microsoft.svg" alt="Microsoft" width={20} height={20} />
        <span>Sign up with Microsoft</span>
      </Button>

      <div className="flex w-full items-center gap-3 text-xs text-text-tertiary">
        <span className="h-px flex-1 bg-border" />
        <span>or continue with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First Name" error={errors.firstName}>
            <Input
              type="text"
              name="firstName"
              placeholder="Enter your first name"
              value={formData.firstName}
              onChange={handleChange}
              autoComplete="given-name"
              startIcon={<User aria-hidden="true" />}
            />
          </Field>
          <Field label="Last Name" error={errors.lastName}>
            <Input
              type="text"
              name="lastName"
              placeholder="Enter your last name"
              value={formData.lastName}
              onChange={handleChange}
              autoComplete="family-name"
              startIcon={<User aria-hidden="true" />}
            />
          </Field>
        </div>

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
            placeholder="Create a password (min. 12 characters)"
            value={formData.password}
            onChange={handleChange}
            autoComplete="new-password"
            startIcon={<Lock aria-hidden="true" />}
          />
        </Field>

        <PasswordStrengthIndicator password={formData.password} />

        <Field label="Confirm Password" error={errors.confirmPassword}>
          <PasswordInput
            name="confirmPassword"
            placeholder="Confirm your password"
            value={formData.confirmPassword}
            onChange={handleChange}
            autoComplete="new-password"
            startIcon={<Lock aria-hidden="true" />}
          />
        </Field>

        <div className="flex w-full flex-col gap-1">
          <label className="flex items-start gap-2 text-sm text-text-secondary">
            <Checkbox
              name="agreeTerms"
              checked={formData.agreeTerms}
              onCheckedChange={(checked) => {
                setFormData((prev) => ({ ...prev, agreeTerms: checked === true }));
                if (errors.agreeTerms) setErrors((prev) => ({ ...prev, agreeTerms: '' }));
              }}
              className="mt-0.5"
            />
            <span>
              I agree to the Theraptly{' '}
              <Link href="/terms" className="font-medium text-primary hover:underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="font-medium text-primary hover:underline">
                Privacy Policy
              </Link>
            </span>
          </label>
          {errors.agreeTerms && <span className="text-sm text-error">{errors.agreeTerms}</span>}
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={isFormLoading || isPending}
          disabled={
            isFormLoading ||
            isPending ||
            !formData.firstName.trim() ||
            !formData.lastName.trim() ||
            !formData.email ||
            !formData.password ||
            !formData.confirmPassword ||
            !formData.agreeTerms
          }
        >
          Create Account
        </Button>
      </form>

      <p className="text-sm text-text-secondary">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Login
        </Link>
      </p>
    </AuthShell>
  );
}
