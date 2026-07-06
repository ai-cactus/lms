'use client';

import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui';
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
    return <div className="p-5 text-center text-text-secondary">Loading MFA settings...</div>;
  }

  return (
    <div className="mt-6 rounded-xl border border-border p-6">
      <h3 className="mb-4 text-base font-semibold text-foreground">Two-Factor Authentication</h3>

      {error && (
        <Alert variant="error" className="mb-4">
          {error}
        </Alert>
      )}

      {info && (
        <Alert variant="success" className="mb-4">
          {info}
        </Alert>
      )}

      {/* ── Idle: MFA not enabled ──────────────────────────────────────────── */}
      {state === 'idle' && (
        <div>
          <p className="mb-4 text-sm text-text-secondary">
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
          <p className="mb-4 text-sm text-text-secondary">
            We&apos;ve sent a 6-digit code to your email. Enter it below to activate two-factor
            authentication.
          </p>

          <div className="mb-3 flex items-start gap-2">
            <Input
              type="text"
              value={verifyCode}
              onChange={(e) => {
                setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                if (error) setError('');
              }}
              placeholder="000000"
              className="w-[120px] text-center text-base tracking-[4px]"
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
            className="cursor-pointer border-none bg-transparent text-[13px] text-text-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Recovery Codes Display ─────────────────────────────────────────── */}
      {state === 'recovery-codes' && (
        <div>
          <Alert variant="warning" className="mb-4" title="Important">
            Save these recovery codes in a safe place. Each code can only be used once. You
            won&apos;t see them again.
          </Alert>

          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-background-secondary p-4 font-mono text-sm">
            {recoveryCodes.map((code, i) => (
              <div key={i} className="px-2 py-1 text-foreground">
                {code}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
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
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-success">
            <ShieldCheck className="size-5" aria-hidden="true" />
            Two-factor authentication is enabled
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-3 text-sm text-text-secondary">
              To disable two-factor authentication or regenerate recovery codes, first request a
              verification code sent to your email:
            </p>

            <div className="mb-3">
              {disableCooldown > 0 ? (
                <span className="text-[13px] text-text-tertiary">Resend in {disableCooldown}s</span>
              ) : (
                <button
                  onClick={handleSendDisableCode}
                  disabled={loading}
                  className={`border-none bg-transparent p-0 text-[13px] text-primary underline ${
                    loading ? 'cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {loading ? 'Sending...' : 'Send verification code to my email'}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-start gap-2">
              <Input
                type="text"
                value={disableCode}
                onChange={(e) => {
                  setDisableCode(e.target.value.toUpperCase());
                  if (error) setError('');
                }}
                placeholder="Code or recovery code"
                className="w-[120px] text-center text-base tracking-[4px]"
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
