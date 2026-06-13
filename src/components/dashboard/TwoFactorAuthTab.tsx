'use client';

import React, { useState, useEffect } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui';
import {
  requestMfaSetup,
  verifyMfaSetup,
  disableMfa,
  getMfaStatus,
  sendDisableMfaCode,
} from '@/app/actions/mfa';

interface TwoFactorAuthTabProps {
  onSuccess?: () => void;
  userEmail?: string;
}

export function TwoFactorAuthTab({ onSuccess }: TwoFactorAuthTabProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [isDisableMode, setIsDisableMode] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableCodeSent, setDisableCodeSent] = useState(false);
  const [disableCooldown, setDisableCooldown] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await getMfaStatus();
        if ('enabled' in res) {
          setIsEnabled(res.enabled);
        } else {
          setMessage({ type: 'error', text: res.error });
        }
      } catch {
        setMessage({ type: 'error', text: 'Failed to load MFA status' });
      } finally {
        setIsLoading(false);
      }
    }
    loadStatus();
  }, []);

  // Cooldown timer for resend
  useEffect(() => {
    if (disableCooldown <= 0) return;
    const t = setInterval(() => {
      setDisableCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [disableCooldown]);

  const handleSetupInit = async () => {
    setIsActionLoading(true);
    setMessage(null);
    try {
      const res = await requestMfaSetup();
      if (res.success) {
        setIsSetupMode(true);
      } else {
        setMessage({
          type: 'error',
          text: !res.success ? res.error : 'Failed to initialize setup',
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setMessage({ type: 'error', text: 'Please enter a valid 6-digit code' });
      return;
    }

    setIsActionLoading(true);
    setMessage(null);
    try {
      const res = await verifyMfaSetup(verificationCode);
      if (res.success && res.data) {
        setIsEnabled(true);
        setIsSetupMode(false);
        setRecoveryCodes(res.data.recoveryCodes as string[]);
        setMessage({ type: 'success', text: 'Two-Factor Authentication enabled successfully!' });
        if (onSuccess) onSuccess();
      } else {
        setMessage({ type: 'error', text: !res.success ? res.error : 'Invalid code' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Step 1: send a fresh OTP to email so user can confirm disable
  const handleDisableInit = async () => {
    setIsActionLoading(true);
    setMessage(null);
    try {
      const res = await sendDisableMfaCode();
      if (res.success) {
        setIsDisableMode(true);
        setDisableCodeSent(true);
        setDisableCooldown(60);
      } else {
        setMessage({ type: 'error', text: !res.success ? res.error : 'Failed to send code' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Step 2: confirm disable with the OTP that was emailed
  const handleDisableConfirm = async () => {
    if (!disableCode || (disableCode.length !== 6 && disableCode.length < 8)) {
      setMessage({ type: 'error', text: 'Please enter a valid 6-digit code or recovery code' });
      return;
    }

    setIsActionLoading(true);
    setMessage(null);
    try {
      const res = await disableMfa(disableCode);
      if (res.success) {
        setIsEnabled(false);
        setIsDisableMode(false);
        setDisableCodeSent(false);
        setDisableCode('');
        setRecoveryCodes(null);
        setMessage({ type: 'success', text: 'Two-Factor Authentication disabled successfully.' });
      } else {
        setMessage({ type: 'error', text: !res.success ? res.error : 'Failed to disable 2FA' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResendDisableCode = async () => {
    setIsActionLoading(true);
    setMessage(null);
    try {
      const res = await sendDisableMfaCode();
      if (res.success) {
        setDisableCooldown(60);
        setMessage({ type: 'success', text: 'A new code has been sent to your email.' });
      } else {
        setMessage({ type: 'error', text: !res.success ? res.error : 'Failed to send code' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsActionLoading(false);
    }
  };

  if (isLoading) {
    return <div className="p-10 text-center">Loading MFA status...</div>;
  }

  // --- RECOVERY CODES VIEW ---
  if (recoveryCodes) {
    return (
      <div className="w-full max-w-[600px] px-10 pb-10">
        <h3 className="mb-4 text-xl font-semibold">Save your recovery codes</h3>
        <p className="mb-6 text-sm leading-normal text-text-secondary">
          Recovery codes can be used to access your account if you lose access to your email or
          cannot receive the verification code. <strong>Each code can only be used once.</strong>
        </p>

        <div className="mb-6 grid grid-cols-2 gap-3 rounded-[10px] border border-border bg-background-secondary p-6">
          {recoveryCodes.map((code, idx) => (
            <code
              key={idx}
              className="font-mono text-base font-semibold tracking-wide text-foreground"
            >
              {code}
            </code>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => setRecoveryCodes(null)}>I have saved these codes</Button>
        </div>
      </div>
    );
  }

  // --- SETUP WIZARD VIEW ---
  if (isSetupMode) {
    return (
      <div className="w-full max-w-[600px] px-10 pb-10">
        <h3 className="mb-6 text-xl font-semibold">Check your email</h3>
        {message && (
          <Alert variant={message.type} className="mb-6">
            {message.text}
          </Alert>
        )}

        <div className="mb-8">
          <p className="mb-4 text-sm leading-normal text-text-secondary">
            We&apos;ve sent a 6-digit verification code to your email address. Please enter the code
            below to enable Two-Factor Authentication.
          </p>
          <Input
            value={verificationCode}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="Enter code"
            className={`max-w-[240px] text-base ${verificationCode ? 'font-mono tracking-[4px]' : ''}`}
          />
        </div>

        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={() => {
              setIsSetupMode(false);
              setVerificationCode('');
            }}
            disabled={isActionLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleVerify} loading={isActionLoading} className="min-w-[100px]">
            Enable 2FA
          </Button>
        </div>
      </div>
    );
  }

  // --- DISABLE CONFIRMATION VIEW ---
  if (isDisableMode) {
    return (
      <div className="w-full max-w-[600px] px-10 pb-10">
        <h3 className="mb-2 text-xl font-semibold">Disable Two-Factor Authentication</h3>
        <p className="mb-6 text-sm leading-normal text-text-secondary">
          {disableCodeSent
            ? "We've sent a verification code to your email. Enter it below to confirm."
            : 'Enter your verification code to confirm.'}
        </p>

        {message && (
          <Alert variant={message.type} className="mb-6">
            {message.text}
          </Alert>
        )}

        <Input
          value={disableCode}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setDisableCode(e.target.value.toUpperCase())
          }
          placeholder="Enter code or recovery code"
          className={`mb-4 max-w-[240px] text-base ${disableCode ? 'font-mono tracking-[4px]' : ''}`}
        />

        <div className="mb-4 flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setIsDisableMode(false);
              setDisableCode('');
              setMessage(null);
            }}
            disabled={isActionLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDisableConfirm}
            loading={isActionLoading}
            className="min-w-[120px]"
          >
            Disable 2FA
          </Button>
        </div>

        <div className="text-[13px] text-text-tertiary">
          {disableCooldown > 0 ? (
            <span>Resend code in {disableCooldown}s</span>
          ) : (
            <button
              type="button"
              onClick={handleResendDisableCode}
              disabled={isActionLoading}
              className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-primary underline"
            >
              Resend code
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- ENABLED / DISABLED DEFAULT VIEW ---
  return (
    <div className="w-full max-w-[600px] px-10 pb-10">
      {message && (
        <Alert variant={message.type} className="mb-6">
          {message.text}
        </Alert>
      )}

      {isEnabled ? (
        <div>
          <div className="mb-4 flex items-center gap-4">
            {/* Toggle Switch UI */}
            <div
              onClick={handleDisableInit}
              className={`relative h-6 w-11 cursor-pointer rounded-xl bg-primary transition-colors duration-200 ${
                isActionLoading ? 'opacity-70' : 'opacity-100'
              }`}
            >
              <div className="absolute top-0.5 left-[22px] size-5 rounded-full bg-white shadow-sm transition-all duration-200" />
            </div>
            <span className="text-[15px] font-semibold text-foreground">On</span>
          </div>

          <div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
            <span>2FA is enabled on your Theraptly account.</span>
            <button
              onClick={() => {
                alert(
                  'For security reasons, recovery codes are only shown once during setup. If you lost them, you must disable and re-enable 2FA.',
                );
              }}
              className="cursor-pointer border-none bg-transparent p-0 text-primary"
            >
              See your recovery codes.
            </button>
          </div>

          <p className="text-sm text-foreground">
            We&apos;ll send a verification code to your email anytime you log in on a device we
            don&apos;t recognize.
          </p>
        </div>
      ) : (
        <div>
          <div className="mb-6 flex items-center justify-between rounded-[10px] border border-border p-6">
            <div className="flex items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-[10px] bg-background-secondary text-text-secondary">
                <Mail className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h4 className="m-0 mb-1 text-[15px] font-semibold">Email Verification</h4>
                <p className="m-0 text-[13px] text-text-secondary">
                  One-time code sent to your email
                </p>
              </div>
            </div>
            <Button onClick={handleSetupInit} loading={isActionLoading}>
              Set up 2FA
            </Button>
          </div>
          <p className="text-sm text-text-secondary">2FA is disabled on your Theraptly account.</p>
        </div>
      )}
    </div>
  );
}
