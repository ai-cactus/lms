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
};

export default nextConfig;
