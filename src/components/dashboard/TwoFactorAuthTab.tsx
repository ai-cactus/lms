'use client';

import React, { useState, useEffect } from 'react';
import styles from './ProfileForm.module.css';
import { Button, Input } from '@/components/ui';
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
      <div className="px-10 pb-10 max-w-[600px] w-full">
        <h3 className="text-xl font-semibold mb-4">Save your recovery codes</h3>
        <p className="text-slate-500 text-sm mb-6 leading-normal">
          Recovery codes can be used to access your account if you lose access to your email or
          cannot receive the verification code. <strong>Each code can only be used once.</strong>
        </p>

        <div className="grid grid-cols-2 gap-3 bg-slate-50 p-6 rounded-lg border border-slate-200 mb-6">
          {recoveryCodes.map((code, idx) => (
            <code
              key={idx}
              className="font-mono text-base font-semibold text-slate-700 tracking-wide"
            >
              {code}
            </code>
          ))}
        </div>

        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => setRecoveryCodes(null)}
            className="bg-indigo-600"
          >
            I have saved these codes
          </Button>
        </div>
      </div>
    );
  }

  // --- SETUP WIZARD VIEW ---
  if (isSetupMode) {
    return (
      <div className="px-10 pb-10 max-w-[600px] w-full">
        <h3 className="text-xl font-semibold mb-6">Check your email</h3>
        {message && (
          <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>
        )}

        <div className="mb-8">
          <p className="text-slate-500 text-sm mb-4 leading-normal">
            We&apos;ve sent a 6-digit verification code to your email address. Please enter the code
            below to enable Two-Factor Authentication.
          </p>
          <Input
            value={verificationCode}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="Enter code"
            className="max-w-[240px] text-base"
            style={{
              letterSpacing: verificationCode ? '4px' : 'normal',
              fontFamily: verificationCode ? 'monospace' : 'inherit',
            }}
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
          <Button
            variant="primary"
            onClick={handleVerify}
            loading={isActionLoading}
            className="bg-indigo-600 min-w-[100px]"
          >
            Enable 2FA
          </Button>
        </div>
      </div>
    );
  }

  // --- DISABLE CONFIRMATION VIEW ---
  if (isDisableMode) {
    return (
      <div className="px-10 pb-10 max-w-[600px] w-full">
        <h3 className="text-xl font-semibold mb-2">Disable Two-Factor Authentication</h3>
        <p className="text-slate-500 text-sm mb-6 leading-normal">
          {disableCodeSent
            ? "We've sent a verification code to your email. Enter it below to confirm."
            : 'Enter your verification code to confirm.'}
        </p>

        {message && (
          <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>
        )}

        <Input
          value={disableCode}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setDisableCode(e.target.value.toUpperCase())
          }
          placeholder="Enter code or recovery code"
          className="max-w-[240px] text-base mb-4"
          style={{
            letterSpacing: disableCode ? '4px' : 'normal',
            fontFamily: disableCode ? 'monospace' : 'inherit',
          }}
        />

        <div className="flex gap-3 items-center mb-4">
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
            onClick={handleDisableConfirm}
            loading={isActionLoading}
            className="bg-red-600 text-white min-w-[120px]"
          >
            Disable 2FA
          </Button>
        </div>

        <div className="text-[13px] text-slate-400">
          {disableCooldown > 0 ? (
            <span>Resend code in {disableCooldown}s</span>
          ) : (
            <button
              type="button"
              onClick={handleResendDisableCode}
              disabled={isActionLoading}
              className="bg-transparent border-none text-indigo-600 text-[13px] cursor-pointer p-0 underline"
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
    <div className="px-10 pb-10 max-w-[600px] w-full">
      {message && <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>}

      {isEnabled ? (
        <div>
          <div className="flex items-center gap-4 mb-4">
            {/* Toggle Switch UI */}
            <div
              onClick={handleDisableInit}
              className="w-11 h-6 rounded-xl bg-indigo-600 relative cursor-pointer transition-colors duration-200"
              style={{ opacity: isActionLoading ? 0.7 : 1 }}
            >
              <div
                className="w-5 h-5 rounded-full bg-white absolute top-0.5 left-[22px] transition-left duration-200 shadow-sm"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
              />
            </div>
            <span className="text-[15px] font-semibold text-slate-800">On</span>
          </div>

          <div className="text-sm text-slate-500 mb-6 flex gap-2 items-center">
            <span>2FA is enabled on your Theraptly account.</span>
            <button
              onClick={() => {
                alert(
                  'For security reasons, recovery codes are only shown once during setup. If you lost them, you must disable and re-enable 2FA.',
                );
              }}
              className="bg-transparent border-none text-indigo-600 cursor-pointer p-0"
            >
              See your recovery codes.
            </button>
          </div>

          <p className="text-sm text-slate-800">
            We&apos;ll send a verification code to your email anytime you log in on a device we
            don&apos;t recognize.
          </p>
        </div>
      ) : (
        <div>
          <div className="border border-slate-200 rounded-lg p-6 flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                {/* Email icon */}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <div>
                <h4 className="m-0 mb-1 text-[15px] font-semibold">Email Verification</h4>
                <p className="m-0 text-[13px] text-slate-500">One-time code sent to your email</p>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={handleSetupInit}
              loading={isActionLoading}
              className="bg-indigo-600"
            >
              Set up 2FA
            </Button>
          </div>
          <p className="text-sm text-slate-500">2FA is disabled on your Theraptly account.</p>
        </div>
      )}
    </div>
  );
}
