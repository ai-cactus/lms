import React from 'react';
import Link from 'next/link';

interface ComingSoonProps {
  title: string;
  description?: string;
  returnUrl?: string; // Optional URL to return to
}

export default function ComingSoon({
  title,
  description,
  returnUrl = '/dashboard',
}: ComingSoonProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '60vh',
        textAlign: 'center',
        padding: '24px',
        color: '#4A5568',
      }}
    >
      <div
        style={{
          backgroundColor: '#EBF8FF',
          color: '#3182CE',
          padding: '16px',
          borderRadius: '50%',
          marginBottom: '24px',
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      </div>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px', color: '#2D3748' }}>
        {title}
      </h1>
      <p style={{ fontSize: '16px', maxWidth: '400px', marginBottom: '32px', lineHeight: '1.5' }}>
        {description || "We're working hard to bring this feature to you. Check back soon!"}
      </p>
      <Link href={returnUrl}>
        <button
          style={{
            backgroundColor: '#3182CE',
            color: 'white',
            padding: '10px 24px',
            borderRadius: '6px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          Return to Dashboard
        </button>
      </Link>
    </div>
  );
}
