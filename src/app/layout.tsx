import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { JetBrains_Mono } from 'next/font/google';
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

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
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
    <html lang="en" className={`${suisseIntl.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
