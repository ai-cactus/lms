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
    ];
  },
};

export default nextConfig;
