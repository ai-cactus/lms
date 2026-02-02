'use client';

import React from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif' }}>
            <h1>Forgot Password</h1>
            <p>This feature is coming soon.</p>
            <Link href="/login" style={{ marginTop: '20px', color: 'blue', textDecoration: 'underline' }}>
                Back to Login
            </Link>
        </div>
    );
}
