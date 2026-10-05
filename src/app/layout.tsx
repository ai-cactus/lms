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

// These were next/font/google, which downloads the files at build time, so a
// network blip failed the build (TOOL-26). They are the same Google Fonts releases,
// committed under ./fonts (see its README.md).
//
// Google serves each family as per-script files, fetched by `unicode-range`, and
// only latin is preloaded. That is kept: each family is a latin face (preloaded)
// plus a latin-ext face, and the public variable lists latin-ext first with the
// latin family as its fallback — the latin-ext range excludes basic Latin, so
// ordinary text never downloads it. The fallback metrics come from the latin file.
//
// Each variable file is declared once per weight Google used to be asked for,
// because Google emitted one @font-face per weight: a weight in between (the
// certificate's Playfair 500) must keep snapping to the nearest declared face.
const jetbrainsMonoLatin = localFont({
  src: './fonts/jetbrains-mono/JetBrainsMono-latin.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-jetbrains-mono-latin',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono/JetBrainsMono-latin-ext.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: ['var(--font-jetbrains-mono-latin)'],
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
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
  // Only the certificate uses it, which never renders on first paint (it is a
  // modal preview or an off-screen export that waits for it), so preloading
  // it would charge every page for a font almost none of them show.
  preload: false,
  adjustFontFallback: 'Times New Roman',
});

const geistLatin = localFont({
  src: [
    { path: './fonts/geist/Geist-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/geist/Geist-latin.woff2', weight: '500', style: 'normal' },
    { path: './fonts/geist/Geist-latin.woff2', weight: '600', style: 'normal' },
    { path: './fonts/geist/Geist-latin.woff2', weight: '700', style: 'normal' },
    { path: './fonts/geist/Geist-latin.woff2', weight: '800', style: 'normal' },
    { path: './fonts/geist/Geist-latin.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-geist-latin',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const geist = localFont({
  src: [
    { path: './fonts/geist/Geist-latin-ext.woff2', weight: '400', style: 'normal' },
    { path: './fonts/geist/Geist-latin-ext.woff2', weight: '500', style: 'normal' },
    { path: './fonts/geist/Geist-latin-ext.woff2', weight: '600', style: 'normal' },
    { path: './fonts/geist/Geist-latin-ext.woff2', weight: '700', style: 'normal' },
    { path: './fonts/geist/Geist-latin-ext.woff2', weight: '800', style: 'normal' },
    { path: './fonts/geist/Geist-latin-ext.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-geist',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: ['var(--font-geist-latin)'],
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
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
      className={`${suisseIntl.variable} ${jetbrainsMonoLatin.variable} ${jetbrainsMono.variable} ${playfairDisplay.variable} ${geistLatin.variable} ${geist.className} ${switzer.className}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
