'use client';

import React, { useState, useEffect } from 'react';
import styles from './ProfileForm.module.css';
import { Button, Input } from '@/components/ui';
import { requestMfaSetup, verifyMfaSetup, disableMfa, getMfaStatus } from '@/app/actions/mfa';

interface TwoFactorAuthTabProps {
  onSuccess?: () => void;
  userEmail?: string;
}

export function TwoFactorAuthTab({ onSuccess }: TwoFactorAuthTabProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

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

  const handleDisable = async () => {
    const code = prompt(
      'Please enter your 6-digit email code or a recovery code to disable 2FA. (If you need a new code, you can log out and log back in):',
    );
    if (!code) return;

    setIsActionLoading(true);
    setMessage(null);
    try {
      const res = await disableMfa(code);
      if (res.success) {
        setIsEnabled(false);
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
          Recovery codes can be used to access your account if you lose access to your authenticator
          app. Please save these codes in a secure location, such as a password manager.
          <strong> Each code can only be used once.</strong>
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
            Next
          </Button>
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
              onClick={handleDisable}
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
              onClick={async () => {
                // If they want to see recovery codes, maybe regenerate them since they shouldn't be viewable again usually.
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
            We&apos;ll ask for a login code anytime you log in on a device we don&apos;t recognize.
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
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                </svg>
              </div>
              <div>
                <h4 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>
                  Authenticator
                </h4>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                  Time-based one-time 6-digits
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
