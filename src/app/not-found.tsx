import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Home } from 'lucide-react';
import Logo from '@/components/ui/Logo';

export const metadata: Metadata = {
  title: 'Page Not Found | Theraptly',
  description: 'The page you were looking for could not be found.',
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Navigation ── */}
      <nav
        className="flex h-14 items-center justify-between border-b border-[#e8eaf0] px-4 sm:h-16 sm:px-10"
        aria-label="Site navigation"
      >
        <Link href="/" aria-label="Theraptly home">
          <Logo size="sm" variant="blue" />
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/signup"
            className="hidden rounded-lg px-4 py-2 text-sm font-medium text-[#2d3748] transition-colors hover:bg-[#f7fafc] sm:inline-flex"
          >
            Sign up
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Log in
          </Link>
        </div>
      </nav>

      {/* ── Main content ── */}
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10 sm:py-16">
        <div className="flex w-full max-w-[860px] flex-col items-center gap-10 text-center md:flex-row md:gap-20 md:text-left">
          {/* Illustration */}
          <div
            className="relative flex size-[210px] shrink-0 items-center justify-center sm:size-[280px] sm:w-[320px]"
            aria-hidden="true"
          >
            <div className="absolute inset-0 z-0 rounded-[60%_40%_55%_45%/50%_55%_45%_50%] bg-[#f0f2f8]" />
            <Image
              src="/images/plug.png"
              alt="Disconnected plug illustration"
              width={260}
              height={220}
              className="relative z-[1] h-auto w-[190px] object-contain sm:w-[260px]"
              priority
            />
          </div>

          {/* Text */}
          <div className="min-w-0 flex-1">
            <h1 className="mb-4 text-2xl font-bold leading-tight tracking-[-0.02em] text-[#1a202c] sm:text-[2.25rem]">
              Page Not Found
            </h1>
            <p className="mb-9 max-w-full text-base leading-[1.65] text-[#9ca3af] md:max-w-[320px]">
              The page you were looking for seems to have gone missing. Request for the link again.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-7 py-[11px] text-[15px] font-semibold text-white transition-colors hover:bg-primary/90"
              >
                <Home className="size-4" aria-hidden="true" />
                Go to Homepage
              </Link>

              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-[10px] border-[1.5px] border-[#e2e8f0] px-6 py-2.5 text-[15px] font-medium text-[#4a5568] transition-colors hover:border-[#cbd5e0] hover:bg-[#f7fafc]"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
