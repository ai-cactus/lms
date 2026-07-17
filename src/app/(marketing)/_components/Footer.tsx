import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="flex w-full justify-center border-t border-border bg-background px-6 py-8">
      <div className="flex w-full max-w-[1200px] flex-col items-center gap-6 text-center md:flex-row md:items-center md:justify-between md:gap-0 md:text-left">
        <div className="flex flex-col items-center gap-4 md:flex-row md:items-center md:gap-8">
          <span className="text-[15px] text-text-secondary">
            &copy; 2026 Theraptly. All rights reserved.
          </span>
          <div className="flex flex-col items-center gap-4 md:flex-row md:gap-6">
            <Link
              href="/privacy"
              className="text-[15px] text-text-secondary transition-colors hover:text-foreground"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-[15px] text-text-secondary transition-colors hover:text-foreground"
            >
              Terms of Service
            </Link>
          </div>
        </div>
        <div className="flex items-center">
          <a
            href="https://linkedin.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center text-text-secondary transition-colors hover:text-foreground"
            aria-label="LinkedIn"
          >
            {/* Brand glyph: lucide has no LinkedIn icon in this version — keep inline brand SVG */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="size-6"
            >
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
