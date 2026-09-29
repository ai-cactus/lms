import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from '@/components/providers/Providers';

const suisseIntl = localFont({
  src: [
    {
      path: '../../public/fonts/SuisseIntl-Regular/web/font/SuisseIntl-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--font-suisse',
  display: 'swap',
  preload: true,
});

const switzer = localFont({
  src: '../../public/fonts/Switzer/Fonts/WEB/fonts/Switzer-Variable.woff2',
  variable: '--font-switzer',
  weight: '100 900',
  display: 'swap',
});

// The fonts below were next/font/google, which downloads the files at build time,
// so a network blip failed the build (TOOL-26). They are now the same Google Fonts
// releases committed under ./fonts. Each variable file is declared once per weight
// that was previously requested, because Google emitted one @font-face per weight:
// a weight in between (the certificate's Playfair 500) must keep snapping to the
// nearest declared face rather than rendering a new intermediate weight.
const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono/JetBrainsMono-Variable.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

// Display serif for the certificate heading ("CERTIFICATE OF / COMPLETION").
const playfairDisplay = localFont({
  src: [
    {
      path: './fonts/playfair-display/PlayfairDisplay-Variable.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/playfair-display/PlayfairDisplay-Variable.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './fonts/playfair-display/PlayfairDisplay-Variable.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: './fonts/playfair-display/PlayfairDisplay-Variable.woff2',
      weight: '800',
      style: 'normal',
    },
  ],
  variable: '--font-playfair',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});

const geist = localFont({
  src: [
    { path: './fonts/geist/Geist-Variable.woff2', weight: '400', style: 'normal' },
    { path: './fonts/geist/Geist-Variable.woff2', weight: '500', style: 'normal' },
    { path: './fonts/geist/Geist-Variable.woff2', weight: '600', style: 'normal' },
    { path: './fonts/geist/Geist-Variable.woff2', weight: '700', style: 'normal' },
    { path: './fonts/geist/Geist-Variable.woff2', weight: '800', style: 'normal' },
    { path: './fonts/geist/Geist-Variable.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-geist',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Theraptly',
  description: 'LMS for Healthcare Compliance',
  icons: {
    icon: '/icon.svg',
  },
};

// No `maximumScale`: pinning it to 1 blocks pinch-zoom on Android Chrome, which
// is a WCAG 1.4.4 (Resize Text) failure and reads to users as "the page isn't
// responsive".
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${suisseIntl.variable} ${jetbrainsMono.variable} ${playfairDisplay.variable} ${geist.className} ${switzer.className}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
