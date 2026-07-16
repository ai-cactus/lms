import Link from 'next/link';

const gutter = 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-12 xl:px-[110px]';

const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 rounded-sm';

// LinkedIn brand glyph — lucide-react (v1.x) no longer ships brand/social icons,
// so this bespoke brand mark stays an inline SVG per the approved marketing-port
// exception in CLAUDE.md.
function LinkedInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="bg-white">
      <div className={`${gutter} flex flex-wrap items-center justify-between gap-y-4 py-7`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[16px] leading-relaxed text-[#1d1d1d]">
          <span>© 2026 Theraptly. All rights reserved.</span>
          <Link href="/partners" className={`hover:text-brand ${focusRing}`}>
            Partner Program
          </Link>
          <Link href="/privacy" className={`hover:text-brand ${focusRing}`}>
            Privacy Policy
          </Link>
          <Link href="/terms" className={`hover:text-brand ${focusRing}`}>
            Terms of Service
          </Link>
        </div>

        <Link
          href="https://www.linkedin.com/company/theraptly"
          aria-label="Theraptly on LinkedIn"
          className={`text-[#1d1d1d] transition-colors hover:text-brand ${focusRing}`}
        >
          <LinkedInIcon />
        </Link>
      </div>
    </footer>
  );
}
