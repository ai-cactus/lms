import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    qualities: [75, 100],
  },
  serverExternalPackages: ['pdf-parse', 'pdfkit', '@google-cloud/storage'],
  async redirects() {
    return [
      {
        source: '/dashboard/auditor-pack',
        destination: '/dashboard/audit-reports',
        permanent: false,
      },
      {
        // The legacy /verify-2fa step-up page was removed when 2FA consolidated
        // onto the single /mfa/verify email-OTP flow. Catch stale bookmarks and
        // in-flight back-button hits during deploy so they land on /login (which
        // re-mints a fresh MFA challenge) rather than a 404.
        source: '/verify-2fa',
        destination: '/login',
        permanent: false,
      },
    ];
  },
  async headers() {
    // Pragmatic CSP: the app relies on Next.js inline runtime styles/scripts,
    // Quill, react-pdf (blob: workers), recharts, and framer-motion, and it
    // talks to its own API and Stripe. 'unsafe-inline'/'unsafe-eval' and the
    // blob:/data:/https: sources below keep those working; tighten only with
    // verified nonce/hash support to avoid breaking the running app.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
