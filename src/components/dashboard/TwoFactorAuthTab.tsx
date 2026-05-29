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
    if (!disableCode) {
      setMessage({ type: 'error', text: 'Please enter the verification code sent to your email' });
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
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading MFA status...</div>;
  }

  // --- RECOVERY CODES VIEW ---
  if (recoveryCodes) {
    return (
      <div style={{ padding: '0 40px 40px', maxWidth: '600px', width: '100%' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '16px' }}>
          Save your recovery codes
        </h3>
        <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
          Recovery codes can be used to access your account if you lose access to your email or
          cannot receive the verification code. <strong>Each code can only be used once.</strong>
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            background: '#f8fafc',
            padding: '24px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            marginBottom: '24px',
          }}
        >
          {recoveryCodes.map((code, idx) => (
            <code
              key={idx}
              style={{
                fontFamily: 'monospace',
                fontSize: '16px',
                fontWeight: 600,
                color: '#334155',
                letterSpacing: '1px',
              }}
            >
              {code}
            </code>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            onClick={() => setRecoveryCodes(null)}
            style={{ backgroundColor: '#4f46e5' }}
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
      <div style={{ padding: '0 40px 40px', maxWidth: '600px', width: '100%' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '24px' }}>
          Check your email
        </h3>
        {message && (
          <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>
        )}

        <div style={{ marginBottom: '32px' }}>
          <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 }}>
            We&apos;ve sent a 6-digit verification code to your email address. Please enter the code
            below to enable Two-Factor Authentication.
          </p>
          <Input
            value={verificationCode}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="Enter code"
            style={{
              maxWidth: '240px',
              letterSpacing: verificationCode ? '4px' : 'normal',
              fontFamily: verificationCode ? 'monospace' : 'inherit',
              fontSize: '16px',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '16px' }}>
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
            style={{ backgroundColor: '#4f46e5', minWidth: '100px' }}
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
      <div style={{ padding: '0 40px 40px', maxWidth: '600px', width: '100%' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
          Disable Two-Factor Authentication
        </h3>
        <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
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
            setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))
          }
          placeholder="Enter 6-digit code"
          style={{
            maxWidth: '240px',
            letterSpacing: disableCode ? '4px' : 'normal',
            fontFamily: disableCode ? 'monospace' : 'inherit',
            fontSize: '16px',
            marginBottom: '16px',
          }}
        />

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
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
            style={{ backgroundColor: '#dc2626', color: 'white', minWidth: '120px' }}
          >
            Disable 2FA
          </Button>
        </div>

        <div style={{ fontSize: '13px', color: '#94a3b8' }}>
          {disableCooldown > 0 ? (
            <span>Resend code in {disableCooldown}s</span>
          ) : (
            <button
              type="button"
              onClick={handleResendDisableCode}
              disabled={isActionLoading}
              style={{
                background: 'none',
                border: 'none',
                color: '#4f46e5',
                fontSize: '13px',
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
              }}
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
    <div style={{ padding: '0 40px 40px', maxWidth: '600px', width: '100%' }}>
      {message && <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>}

      {isEnabled ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            {/* Toggle Switch UI */}
            <div
              onClick={handleDisableInit}
              style={{
                width: '44px',
                height: '24px',
                borderRadius: '12px',
                backgroundColor: '#4f46e5',
                position: 'relative',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
                opacity: isActionLoading ? 0.7 : 1,
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  position: 'absolute',
                  top: '2px',
                  left: '22px', // Toggled On
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </div>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b' }}>On</span>
          </div>

          <div
            style={{
              fontSize: '14px',
              color: '#64748b',
              marginBottom: '24px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <span>2FA is enabled on your Theraptly account.</span>
            <button
              onClick={() => {
                alert(
                  'For security reasons, recovery codes are only shown once during setup. If you lost them, you must disable and re-enable 2FA.',
                );
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#4f46e5',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              See your recovery codes.
            </button>
          </div>

          <p style={{ fontSize: '14px', color: '#1e293b' }}>
            We&apos;ll send a verification code to your email anytime you log in on a device we
            don&apos;t recognize.
          </p>
        </div>
      ) : (
        <div>
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748b',
                }}
              >
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
                <h4 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>
                  Email Verification
                </h4>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                  One-time code sent to your email
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={handleSetupInit}
              loading={isActionLoading}
              style={{ backgroundColor: '#4f46e5' }}
            >
              Set up 2FA
            </Button>
          </div>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            2FA is disabled on your Theraptly account.
          </p>
        </div>
      )}
    </div>
  );
}
