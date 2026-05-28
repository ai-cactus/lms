'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import {
  requestMfaSetup,
  verifyMfaSetup,
  disableMfa,
  regenerateRecoveryCodes,
  sendDisableMfaCode,
  getMfaStatus,
} from '@/app/actions/mfa';

type MfaState = 'loading' | 'idle' | 'setup' | 'verify' | 'recovery-codes' | 'enabled';

export default function MfaSettings() {
  const [state, setState] = useState<MfaState>('loading');
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [disableCooldown, setDisableCooldown] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMfaStatus().then((result) => {
      if (cancelled) return;
      if ('error' in result) {
        setState('idle');
      } else {
        setState(result.enabled ? 'enabled' : 'idle');
      }
    });
    return () => {
      cancelled = true;
    };
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

  // Step 1 of setup: send OTP to email
  const handleSetup = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    const result = await requestMfaSetup();
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setState('setup');
    setLoading(false);
  };

  // Step 2: verify the emailed OTP to activate 2FA
  const handleVerify = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }
    setLoading(true);
    setError('');
    const result = await verifyMfaSetup(verifyCode);
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setRecoveryCodes((result.data?.recoveryCodes as string[]) || []);
    setState('recovery-codes');
    setLoading(false);
  };

  // Send a fresh OTP before disabling
  const handleSendDisableCode = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    const result = await sendDisableMfaCode();
    if (!result.success) {
      setError(!result.success ? result.error : 'Failed to send code');
      setLoading(false);
      return;
    }
    setInfo('A verification code has been sent to your email.');
    setDisableCooldown(60);
    setLoading(false);
  };

  const handleDisable = async () => {
    if (!disableCode) {
      setError('Please enter the verification code sent to your email');
      return;
    }
    setLoading(true);
    setError('');
    const result = await disableMfa(disableCode);
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setDisableCode('');
    setState('idle');
    setLoading(false);
  };

  const handleRegenerateCodes = async () => {
    if (!disableCode) {
      setError('Please enter your email verification code to regenerate recovery codes');
      return;
    }
    setLoading(true);
    setError('');
    const result = await regenerateRecoveryCodes(disableCode);
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setRecoveryCodes((result.data?.recoveryCodes as string[]) || []);
    setDisableCode('');
    setState('recovery-codes');
    setLoading(false);
  };

  const handleDownloadCodes = () => {
    const text = `Theraptly LMS - Recovery Codes\nGenerated: ${new Date().toISOString()}\n\n${recoveryCodes.join('\n')}\n\nStore these codes safely. Each code can only be used once.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'theraptly-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280' }}>
        Loading MFA settings...
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid #E5E7EB',
        borderRadius: '12px',
        padding: '24px',
        marginTop: '24px',
      }}
    >
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: '#111827' }}>
        Two-Factor Authentication
      </h3>

      {error && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            color: '#991B1B',
            padding: '10px 14px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '14px',
            border: '1px solid #FCA5A5',
          }}
        >
          {error}
        </div>
      )}

      {info && (
        <div
          style={{
            backgroundColor: '#F0FDF4',
            color: '#166534',
            padding: '10px 14px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '14px',
            border: '1px solid #BBF7D0',
          }}
        >
          {info}
        </div>
      )}

      {/* ── Idle: MFA not enabled ──────────────────────────────────────────── */}
      {state === 'idle' && (
        <div>
          <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '16px' }}>
            Add an extra layer of security to your account by enabling two-factor authentication. A
            verification code will be sent to your email address each time you log in.
          </p>
          <Button onClick={handleSetup} loading={loading}>
            Enable Two-Factor Authentication
          </Button>
        </div>
      )}

      {/* ── Setup: code sent to email, enter to verify ─────────────────────── */}
      {state === 'setup' && (
        <div>
          <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '16px' }}>
            We&apos;ve sent a 6-digit code to your email. Enter it below to activate two-factor
            authentication.
          </p>

          {/* Verification code input */}
          <div
            style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '12px' }}
          >
            <input
              type="text"
              value={verifyCode}
              onChange={(e) => {
                setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                if (error) setError('');
              }}
              placeholder="000000"
              style={{
                width: '120px',
                padding: '8px 12px',
                border: '1px solid #D1D5DB',
                borderRadius: '6px',
                fontSize: '16px',
                textAlign: 'center',
                letterSpacing: '4px',
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
            />
            <Button onClick={handleVerify} loading={loading}>
              Verify &amp; Enable
            </Button>
          </div>

          <button
            onClick={() => {
              setState('idle');
              setVerifyCode('');
              setError('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#6B7280',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Recovery Codes Display ─────────────────────────────────────────── */}
      {state === 'recovery-codes' && (
        <div>
          <div
            style={{
              backgroundColor: '#FEF3C7',
              border: '1px solid #FCD34D',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '16px',
              fontSize: '14px',
              color: '#92400E',
            }}
          >
            <strong>Important:</strong> Save these recovery codes in a safe place. Each code can
            only be used once. You won&apos;t see them again.
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              marginBottom: '16px',
              padding: '16px',
              backgroundColor: '#F9FAFB',
              borderRadius: '8px',
              fontFamily: 'monospace',
              fontSize: '14px',
            }}
          >
            {recoveryCodes.map((code, i) => (
              <div key={i} style={{ padding: '4px 8px', color: '#374151' }}>
                {code}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={handleDownloadCodes} variant="outline">
              Download Codes
            </Button>
            <Button
              onClick={() => {
                setState('enabled');
                setRecoveryCodes([]);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {/* ── Enabled: MFA is active ─────────────────────────────────────────── */}
      {state === 'enabled' && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
              color: '#16A34A',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Two-factor authentication is enabled
          </div>

          {/* Disable / regenerate section */}
          <div
            style={{
              borderTop: '1px solid #E5E7EB',
              paddingTop: '16px',
              marginTop: '16px',
            }}
          >
            <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '12px' }}>
              To disable two-factor authentication or regenerate recovery codes, first request a
              verification code sent to your email:
            </p>

            {/* Send code button with cooldown */}
            <div style={{ marginBottom: '12px' }}>
              {disableCooldown > 0 ? (
                <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                  Resend in {disableCooldown}s
                </span>
              ) : (
                <button
                  onClick={handleSendDisableCode}
                  disabled={loading}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4F46E5',
                    fontSize: '13px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  {loading ? 'Sending...' : 'Send verification code to my email'}
                </button>
              )}
            </div>

            <div
              style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}
            >
              <input
                type="text"
                value={disableCode}
                onChange={(e) => {
                  setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (error) setError('');
                }}
                placeholder="000000"
                style={{
                  width: '120px',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '16px',
                  textAlign: 'center',
                  letterSpacing: '4px',
                }}
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <Button onClick={handleRegenerateCodes} variant="outline" loading={loading}>
                New Recovery Codes
              </Button>
              <Button onClick={handleDisable} variant="outline" loading={loading}>
                Disable MFA
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
