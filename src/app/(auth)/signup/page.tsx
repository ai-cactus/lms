'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mail, Lock } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Checkbox } from '@/components/ui/checkbox';
import { signup } from '@/app/actions/auth';
import { validatePassword } from '@/lib/password-policy';
import { logger } from '@/lib/logger';
import PasswordStrengthIndicator from '@/components/ui/PasswordStrengthIndicator';

export default function SignupPage() {
  const router = useRouter();

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
    // Calling signIn routes through create-auth-instance.ts, which creates a new
    // admin-instance user as an `owner` when they don't already exist.
    signIn('microsoft-entra-id', {
      callbackUrl: '/dashboard',
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
        newErrors.password = pwCheck.errors[0];
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
    setIsFormLoading(true);

    try {
      const result = await signup({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
      });

      if (result.success) {
        localStorage.setItem('pendingVerificationEmail', formData.email);
        router.push('/verify-email');
      } else {
        setErrors((prev) => ({ ...prev, email: result.error }));
        setIsFormLoading(false);
      }
    } catch (err) {
      logger.error({ msg: '[auth] Signup submit failed', err });
      setErrors((prev) => ({ ...prev, email: 'An unexpected error occurred. Please try again.' }));
      setIsFormLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col h-full w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
          <div className="w-full text-left flex flex-col gap-1">
            <h1 className="text-headline-3 font-semibold font-headline leading-8 text-text-bold">
              Create a new account
            </h1>
            <p className="text-base leading-6 font-text text-text-neutral">
              Create a new account to get started.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-9">
          <Button
            type="button"
            variant="secondary"
            className="w-full gap-3 rounded-full"
            onClick={handleMicrosoftSignup}
            loading={isMicrosoftLoading}
            disabled={isMicrosoftLoading}
          >
            <Image src="/icons/microsoft.svg" alt="Microsoft" width={20} height={20} />
            <span className="font-semibold text-text-title leading-5 text-sm font-text">
              Sign up with Microsoft
            </span>
          </Button>
          <div className="flex w-full items-center gap-3">
            <span className="h-px flex-1 bg-tertiary" />
            <span className="text-xs text-text-neutral font-text">or continue with email</span>
            <span className="h-px flex-1 bg-tertiary" />
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row gap-4">
                <Field label="First Name" error={errors.firstName}>
                  <Input
                    type="text"
                    name="firstName"
                    placeholder="Enter your first name"
                    value={formData.firstName}
                    onChange={handleChange}
                    autoComplete="given-name"
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
                {errors.agreeTerms && (
                  <span className="text-sm text-error">{errors.agreeTerms}</span>
                )}
              </div>
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={isFormLoading}
              disabled={
                isFormLoading ||
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
        </div>
        <p className="text-sm text-text-title font-medium leading-5 text-center pb-9">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
