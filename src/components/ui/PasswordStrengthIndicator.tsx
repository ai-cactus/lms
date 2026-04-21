'use client';

import React from 'react';
import { getPasswordChecks } from '@/lib/password-policy';

interface PasswordStrengthIndicatorProps {
  password: string;
}

const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
const strengthColors = ['', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#16A34A'];

export default function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  if (!password) return null;

  const checks = getPasswordChecks(password);
  const passedCount = checks.filter((c) => c.passed).length;
  const label = strengthLabels[passedCount] || '';
  const color = strengthColors[passedCount] || '#9CA3AF';

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Strength bar */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '6px',
        }}
      >
        {checks.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: '4px',
              borderRadius: '2px',
              backgroundColor: i < passedCount ? color : '#E5E7EB',
              transition: 'background-color 0.2s',
            }}
          />
        ))}
      </div>

      {/* Strength label */}
      {password.length > 0 && (
        <div
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color,
            marginBottom: '8px',
          }}
        >
          {label}
        </div>
      )}

      {/* Individual checks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {checks.map((check) => (
          <div
            key={check.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: check.passed ? '#16A34A' : '#6B7280',
            }}
          >
            {check.passed ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
              </svg>
            )}
            <span>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
