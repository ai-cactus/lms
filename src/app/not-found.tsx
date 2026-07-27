import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import Logo from '@/components/ui/Logo';

export const metadata: Metadata = {
  title: 'Page Not Found | Theraptly',
  description: 'The page you were looking for could not be found.',
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <nav
        className="flex h-[84px] shrink-0 items-center justify-between border-b border-border px-6 sm:px-15"
        aria-label="Site navigation"
      >
        <Link href="/" aria-label="Theraptly home">
          <Logo size="nav" variant="blue" />
        </Link>

        <div className="flex items-center gap-6 sm:gap-12">
          <Link
            href="/signup"
            className="hidden text-sm tracking-[-0.44px] text-[#2d2d2d] transition-colors hover:text-primary sm:inline-flex"
          >
            Sign up
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-[8px] bg-primary px-8 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Log in
          </Link>
        </div>
      </nav>

      <main className="flex flex-1 items-center justify-center px-[8%] py-10 sm:px-10">
        <div className="flex w-full max-w-[1038px] flex-col items-center gap-2.5 text-center md:flex-row md:justify-center md:gap-[57px] md:text-left">
          <Image
            src="/images/page-not-found.svg"
            alt=""
            width={496}
            height={496}
            aria-hidden="true"
            priority
            className="size-[263px] shrink-0 md:size-[496px]"
          />

          <div className="flex flex-col gap-4 md:w-[484px] md:shrink-0 md:gap-5">
            <h1 className="text-[30px] font-semibold leading-tight text-[#2d2d2d] md:text-[45px] md:leading-[50px]">
              Page Not Found
            </h1>
            <p className="text-base leading-[22px] text-[#8d8d8d] md:text-2xl md:leading-[35px]">
              The page you were looking for seems to have gone missing. Request for the link again.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
