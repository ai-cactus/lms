import type { NextConfig } from 'next';

// PostHog ingest is reverse-proxied through this app under /ingest rather than
// called directly, for three reasons:
//
//   1. COMPLIANCE. PostHog's own managed reverse proxy is documented as NOT
//      HIPAA-compliant, so it cannot sit in front of a healthcare product. This
//      one is ours and runs inside our trust boundary.
//   2. CSP. Same-origin ingest means the strict `script-src 'self'` /
//      `connect-src 'self'` policy below keeps working untouched — the naive
//      integration would require whitelisting a third-party script origin.
//   3. Requests are not lost to tracking blockers.
//
// The three rules must stay in THIS order: the two asset rules are more specific
// than the catch-all and would otherwise never match.
const POSTHOG_ASSET_HOST = 'https://us-assets.i.posthog.com';
const POSTHOG_API_HOST = 'https://us.i.posthog.com';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Every request body routed through the proxy is capped at 10MB by default,
    // which truncates the MinIO proxy-upload fallback mid-multipart and surfaces
    // as "Failed to parse body as FormData". Align it with MAX_VIDEO_BYTES so the
    // fallback can carry a real video when direct-to-GCS is unavailable.
    proxyClientMaxBodySize: '500mb',
  },
  images: {
    qualities: [75, 100],
  },
  serverExternalPackages: ['pdf-parse', 'pdfkit', '@google-cloud/storage'],
  // Required by the PostHog ingest endpoints, which are trailing-slash
  // sensitive (e.g. /e/). Without this Next.js issues a redirect that silently
  // breaks event capture.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: `${POSTHOG_ASSET_HOST}/static/:path*`,
      },
      {
        // Remote config (/array/:token/config.js) is served by the asset host so
        // it arrives with cacheable headers.
        source: '/ingest/array/:path*',
        destination: `${POSTHOG_ASSET_HOST}/array/:path*`,
      },
      {
        source: '/ingest/:path*',
        destination: `${POSTHOG_API_HOST}/:path*`,
      },
    ];
  },
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
      // blob: is the locally-selected file previewed before upload; https: is the
      // signed GCS/MinIO playback URL. Without this, media falls back to
      // default-src 'self' and every preview player is blocked.
      "media-src 'self' blob: https:",
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
