/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    qualities: [75, 100],
  },
  // Mark packages with Node.js internals or test fixtures as server-only externals
  // so Next.js/Turbopack doesn't try to bundle them (they're require()'d at runtime).
  serverExternalPackages: ['pdf-parse', 'pdfkit', '@google-cloud/storage'],
};

module.exports = nextConfig;