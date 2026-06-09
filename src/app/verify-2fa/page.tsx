'use client';

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { verifyMfaChallenge, sendCurrentSessionMfaCode } from '@/app/actions/verify-mfa';

function Verify2FAContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0); // seconds remaining
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    setResendCooldown(60);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const sendOtp = useCallback(async () => {
    setIsSending(true);
    setError('');
    try {
      await sendCurrentSessionMfaCode();
      startCooldown();
    } finally {
      setIsSending(false);
    }
  }, [startCooldown]);

  // Send the initial OTP when the page first loads
  useEffect(() => {
    sendOtp();
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!useRecovery) {
      inputRefs.current[0]?.focus();
    }
  }, [useRecovery]);

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    setError('');

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits are filled
    if (digit && index === 5) {
      const fullCode = newCode.join('');
      if (fullCode.length === 6) {
        handleSubmit(fullCode);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newCode = [...code];
    for (let i = 0; i < 6; i++) {
      newCode[i] = pasted[i] || '';
    }
    setCode(newCode);
    if (pasted.length === 6) {
      handleSubmit(pasted);
    } else {
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
  };

  const handleSubmit = async (codeStr?: string) => {
    const submitCode = codeStr ?? (useRecovery ? recoveryCode.trim() : code.join(''));
    if (!submitCode || (!useRecovery && submitCode.length !== 6)) {
      setError('Please enter a complete 6-digit code');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await verifyMfaChallenge(submitCode);
      if (result.success) {
        // Force a full page navigation to ensure the JWT is refreshed
        const safeCallback = callbackUrl.startsWith('/') ? callbackUrl : '/dashboard';
        window.location.assign(safeCallback);
      } else {
        setError(result.error || 'Invalid code. Please try again.');
        setIsLoading(false);
        // Clear the code fields for retry
        if (!useRecovery) {
          setCode(['', '', '', '', '', '']);
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        }
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* Logo / Brand */}
        <div style={logoStyle}>
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>

        <h1 style={titleStyle}>Two-Factor Authentication</h1>
        <p style={subtitleStyle}>
          {useRecovery
            ? 'Enter one of your saved recovery codes to access your account.'
            : "We've sent a 6-digit code to your email address. Enter it below to continue."}
        </p>

        {error && (
          <div style={errorBannerStyle}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {!useRecovery ? (
          <div>
            {/* 6-digit code input */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
                marginBottom: '24px',
              }}
            >
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  disabled={isLoading}
                  style={{
                    width: '52px',
                    height: '60px',
                    textAlign: 'center',
                    fontSize: '24px',
                    fontWeight: 700,
                    border: `2px solid ${digit ? '#4f46e5' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    outline: 'none',
                    color: '#1e293b',
                    background: digit ? '#f5f3ff' : 'white',
                    transition: 'all 0.15s',
                    caretColor: 'transparent',
                    cursor: 'text',
                  }}
                  aria-label={`Digit ${index + 1}`}
                />
              ))}
            </div>

            <button
              onClick={() => handleSubmit()}
              disabled={isLoading || code.join('').length !== 6}
              style={{
                ...submitButtonStyle,
                opacity: isLoading || code.join('').length !== 6 ? 0.65 : 1,
              }}
            >
              {isLoading ? (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    justifyContent: 'center',
                  }}
                >
                  <svg
                    style={{ animation: 'spin 1s linear infinite' }}
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                  </svg>
                  Verifying...
                </span>
              ) : (
                'Verify'
              )}
            </button>

            {/* Resend code */}
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              {resendCooldown > 0 ? (
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                  Resend code in {resendCooldown}s
                </span>
              ) : (
                <button
                  onClick={sendOtp}
                  disabled={isSending}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4f46e5',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: isSending ? 'not-allowed' : 'pointer',
                    opacity: isSending ? 0.6 : 1,
                    textDecoration: 'underline',
                  }}
                >
                  {isSending ? 'Sending...' : "Didn't receive a code? Resend"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <input
              type="text"
              value={recoveryCode}
              onChange={(e) => {
                setRecoveryCode(e.target.value);
                setError('');
              }}
              placeholder="e.g. XXXXX-XXXXX"
              disabled={isLoading}
              style={recoveryInputStyle}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />

            <button
              onClick={() => handleSubmit()}
              disabled={isLoading || !recoveryCode.trim()}
              style={{
                ...submitButtonStyle,
                marginTop: '16px',
                opacity: isLoading || !recoveryCode.trim() ? 0.65 : 1,
              }}
            >
              {isLoading ? 'Verifying...' : 'Use Recovery Code'}
            </button>
          </div>
        )}

        <button
          onClick={() => {
            setUseRecovery(!useRecovery);
            setError('');
            setCode(['', '', '', '', '', '']);
            setRecoveryCode('');
          }}
          style={switchLinkStyle}
          disabled={isLoading}
        >
          {useRecovery
            ? '← Use email code instead'
            : "Can't access your email? Use a recovery code"}
        </button>

        <button
          type="button"
          onClick={() => {
            // Full-page navigation (not client-side) so the browser processes
            // the Set-Cookie headers that clear the session cookies.
            window.location.href = '/api/auth/signout-all';
          }}
          style={logoutLinkStyle}
        >
          Sign out and log in with a different account
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (max-width: 480px) {
          .verify-card { padding: 32px 20px !important; }
        }
      `}</style>
    </div>
  );
}

export default function Verify2FAPage() {
  return (
    <Suspense fallback={<div style={containerStyle}>Loading...</div>}>
      <Verify2FAContent />
    </Suspense>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
};

const cardStyle: React.CSSProperties = {
  background: 'white',
  borderRadius: '20px',
  padding: '48px 40px',
  width: '100%',
  maxWidth: '420px',
  boxShadow: '0 20px 60px rgba(79, 70, 229, 0.12), 0 4px 20px rgba(0, 0, 0, 0.06)',
  border: '1px solid rgba(79, 70, 229, 0.08)',
  textAlign: 'center',
};

const logoStyle: React.CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '16px',
  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 24px',
  boxShadow: '0 8px 24px rgba(79, 70, 229, 0.3)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 700,
  color: '#0f172a',
  marginBottom: '12px',
  lineHeight: 1.3,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#64748b',
  marginBottom: '32px',
  lineHeight: 1.6,
};

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  background: '#fef2f2',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: '10px',
  padding: '12px 16px',
  fontSize: '14px',
  marginBottom: '24px',
  textAlign: 'left',
};

const submitButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
  color: 'white',
  border: 'none',
  borderRadius: '10px',
  fontSize: '16px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
  boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
};

const recoveryInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  border: '2px solid #e2e8f0',
  borderRadius: '10px',
  fontSize: '16px',
  fontFamily: 'monospace',
  letterSpacing: '2px',
  color: '#1e293b',
  outline: 'none',
  boxSizing: 'border-box',
  textAlign: 'center',
  transition: 'border-color 0.2s',
};

const switchLinkStyle: React.CSSProperties = {
  display: 'block',
  marginTop: '24px',
  background: 'none',
  border: 'none',
  color: '#4f46e5',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'underline',
  textDecorationColor: 'transparent',
  transition: 'text-decoration-color 0.2s',
};

const logoutLinkStyle: React.CSSProperties = {
  display: 'block',
  marginTop: '16px',
  color: '#94a3b8',
  fontSize: '13px',
  textDecoration: 'none',
};
