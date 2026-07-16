import { Inter } from 'next/font/google';
import localFont from 'next/font/local';

// Inter with the optical-size axis → large headings render the "Inter Display"
// optical cut automatically (via font-optical-sizing: auto on .font-display).
// Scoped to the marketing surface only (/, /partners) — the app-wide root layout
// keeps its Suisse Int'l brand untouched.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  axes: ['opsz'],
});

const aspekta = localFont({
  src: './fonts/AspektaVF.woff2',
  variable: '--font-aspekta',
  display: 'swap',
  weight: '100 900',
});

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className={`${inter.variable} ${aspekta.variable} font-aspekta flex min-h-screen flex-col bg-surface text-ink`}
    >
      {children}
    </div>
  );
}
