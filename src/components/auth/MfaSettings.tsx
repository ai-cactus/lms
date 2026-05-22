'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import {
  requestMfaSetup,
  verifyMfaSetup,
  disableMfa,
  regenerateRecoveryCodes,
  getMfaStatus,
} from '@/app/actions/mfa';

type MfaState = 'loading' | 'idle' | 'setup' | 'verify' | 'recovery-codes' | 'enabled';

export default function MfaSettings() {
  const [state, setState] = useState<MfaState>('loading');
  const [qrUri, setQrUri] = useState('');
  const [secret, setSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleSetup = async () => {
    setLoading(true);
    setError('');
    const result = await requestMfaSetup();
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setQrUri(result.data?.uri as string);
    setSecret(result.data?.secret as string);
    setState('setup');
    setLoading(false);
  };

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

  const handleDisable = async () => {
    if (!disableCode) {
      setError('Please enter a verification code');
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
      setError('Please enter your authenticator code to regenerate recovery codes');
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

      {/* ── Idle: MFA not enabled ──────────────────────────────────────────── */}
      {state === 'idle' && (
        <div>
          <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '16px' }}>
            Add an extra layer of security to your account by enabling two-factor authentication.
            You&apos;ll need an authenticator app like Google Authenticator or Authy.
          </p>
          <Button onClick={handleSetup} loading={loading}>
            Enable Two-Factor Authentication
          </Button>
        </div>
      )}

      {/* ── Setup: Show QR code ────────────────────────────────────────────── */}
      {state === 'setup' && (
        <div>
          <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '16px' }}>
            Scan the QR code below with your authenticator app, then enter the 6-digit code to
            verify setup.
          </p>

          {/* QR Code */}
          <div
            style={{
              textAlign: 'center',
              marginBottom: '16px',
              padding: '16px',
              backgroundColor: '#F9FAFB',
              borderRadius: '8px',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`}
              alt="MFA QR Code"
              width={200}
              height={200}
              style={{ margin: '0 auto', display: 'block' }}
            />
          </div>

          {/* Manual entry */}
          <details style={{ marginBottom: '16px', fontSize: '13px', color: '#6B7280' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '4px' }}>
              Can&apos;t scan? Enter manually
            </summary>
            <code
              style={{
                display: 'block',
                padding: '8px',
                backgroundColor: '#F3F4F6',
                borderRadius: '4px',
                fontSize: '12px',
                wordBreak: 'break-all',
              }}
            >
              {secret}
            </code>
          </details>

          {/* Verification code input */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
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
            />
            <Button onClick={handleVerify} loading={loading}>
              Verify & Enable
            </Button>
          </div>

          <button
            onClick={() => {
              setState('idle');
              setQrUri('');
              setSecret('');
              setVerifyCode('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#6B7280',
              cursor: 'pointer',
              fontSize: '13px',
              marginTop: '12px',
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

          {/* Disable section */}
          <div
            style={{
              borderTop: '1px solid #E5E7EB',
              paddingTop: '16px',
              marginTop: '16px',
            }}
          >
            <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '12px' }}>
              To disable two-factor authentication or regenerate recovery codes, enter your
              authenticator code:
            </p>
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
