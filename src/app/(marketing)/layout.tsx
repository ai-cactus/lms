import localFont from 'next/font/local';

// Inter with the optical-size axis → large headings render the "Inter Display"
// optical cut automatically (via font-optical-sizing: auto on .font-display).
// Scoped to the marketing surface only (/, /partners) — the app-wide root layout
// keeps its Suisse Int'l brand untouched. Committed rather than next/font/google so
// the build never fetches from Google Fonts (TOOL-26); the latin / latin-ext split
// is explained in the root layout.
const interLatin = localFont({
  src: '../fonts/inter/Inter-latin.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-inter-latin',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const inter = localFont({
  src: '../fonts/inter/Inter-latin-ext.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-inter',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: ['var(--font-inter-latin)'],
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
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
      className={`${interLatin.variable} ${inter.variable} ${aspekta.variable} font-aspekta flex min-h-screen flex-col bg-surface text-ink`}
    >
      {children}
    </div>
  );
}
