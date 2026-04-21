'use client';

import React, { useState, useActionState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import { authenticate } from '@/app/actions/auth';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy';
import styles from './page.module.css';
import { signIn } from 'next-auth/react';
import AuthHeroSlider from '@/components/auth/AuthHeroSlider';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const joined = searchParams.get('joined');
  const oauthError = searchParams.get('error');
  const inactiveReason = searchParams.get('reason');

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

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if ((formData.password || '').length < PASSWORD_MIN_LENGTH) {
      newErrors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('[Login Client] Submit clicked! Current form data:', formData);
    const isValid = validateForm();
    console.log('[Login Client] Validation result:', isValid, errors);
    if (!isValid) return;

    setErrors({});
    // Construct FormData manually
    const form = new FormData();
    form.append('email', formData.email);
    form.append('password', formData.password);

    console.log('[Login Client] Dispatching form to authenticate action...');
    React.startTransition(() => {
      dispatch(form);
    });
  };

  useEffect(() => {
    console.log('[Login Client] Action state changed:', state);
    if (state?.redirect) {
      // Auto-route to the correct login page for their role
      router.push(state.redirect);
    } else if (state?.success) {
      console.log('[Login Client] Success! Redirecting to /dashboard');
      router.push('/dashboard');
    } else if (state?.error) {
      console.log('[Login Client] Error returned from action:', state.error);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional sync of server error to local state for UX control
      setErrors((prev) => ({ ...prev, email: state.error }));
    }
  }, [state, router]);

  return (
    <div className={styles.formContent}>
      <Logo size="md" />

      <div className={styles.formHeader}>
        <h1 className={styles.title}>Log in to your account</h1>
        <p className={styles.subtitle}>Log in to your workspace and get back to what matters.</p>
      </div>

      {joined && (
        <div
          style={{
            backgroundColor: '#ECFDF5',
            color: '#065F46',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px',
            border: '1px solid #A7F3D0',
            fontSize: '14px',
            textAlign: 'center',
          }}
        >
          Account created successfully! Please log in.
        </div>
      )}

      {searchParams.get('verified') && (
        <div
          style={{
            backgroundColor: '#ECFDF5',
            color: '#065F46',
            padding: '16px 20px',
            borderRadius: '12px',
            marginBottom: '24px',
            border: '1px solid #A7F3D0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#10B981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '2px' }}>
              Email verified successfully!
            </div>
            <div style={{ fontSize: '13px', color: '#047857' }}>
              Please log in to continue to your account.
            </div>
          </div>
        </div>
      )}

      {oauthError === 'AccessDenied' && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            color: '#991B1B',
            padding: '16px 20px',
            borderRadius: '12px',
            marginBottom: '24px',
            border: '1px solid #FCA5A5',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#EF4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '2px' }}>
              Access Denied
            </div>
            <div style={{ fontSize: '13px', color: '#B91C1C' }}>
              You do not have authorization to log in with this role.
            </div>
          </div>
        </div>
      )}

      {inactiveReason === 'inactive' && (
        <div
          style={{
            backgroundColor: '#FEF3C7',
            color: '#92400E',
            padding: '16px 20px',
            borderRadius: '12px',
            marginBottom: '24px',
            border: '1px solid #FCD34D',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#F59E0B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '2px' }}>
              Session Expired
            </div>
            <div style={{ fontSize: '13px', color: '#A16207' }}>
              You were logged out due to inactivity. Please log in again.
            </div>
          </div>
        </div>
      )}

      <div className={styles.socialLogin}>
        <Button
          variant="outline"
          type="button"
          className={styles.microsoftButton}
          onClick={handleMicrosoftLogin}
          loading={isMicrosoftLoading}
        >
          <Image src="/icons/microsoft.svg" alt="Microsoft" width={20} height={20} />
          <span>Log In with Microsoft</span>
        </Button>
      </div>

      <div className={styles.divider}>
        <span>or continue with email</span>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <Input
          label="Email"
          type="email"
          name="email"
          placeholder="Enter your email address"
          value={formData.email}
          onChange={handleChange}
          error={errors.email}
          autoComplete="email"
        />

        <Input
          label="Password"
          type="password"
          name="password"
          placeholder="Enter your password"
          value={formData.password}
          onChange={handleChange}
          error={errors.password}
          autoComplete="current-password"
        />

        <div className={styles.formOptions}>
          <Link href="/forgot-password" className={styles.link}>
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={isPending}>
          Log in
        </Button>
      </form>

      <p className={styles.signupPrompt}>
        Don&apos;t have an account?{' '}
        <Link href="/signup" className={styles.signupLink}>
          Sign Up
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className={styles.container}>
      {/* Left Side - Form */}
      <div className={styles.formSection}>
        <Suspense fallback={<div>Loading...</div>}>
          <LoginForm />
        </Suspense>
      </div>

      {/* Right Side - Hero Slider */}
      <AuthHeroSlider />
    </div>
  );
}
