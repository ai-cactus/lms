import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { JetBrains_Mono, Playfair_Display, Geist } from 'next/font/google';
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

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

// Display serif for the certificate heading ("CERTIFICATE OF / COMPLETION").
const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-playfair',
  display: 'swap',
});

const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-geist',
});

export const metadata: Metadata = {
  title: 'Theraptly',
  description: 'LMS for Healthcare Compliance',
  icons: {
    icon: '/icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
