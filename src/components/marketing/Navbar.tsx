'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/marketing/ui/Button';
import { Logo } from '@/components/marketing/ui/Logo';

const NAV_LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'Partners', href: '/partners' },
];

const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // The partner hero is a dark full-bleed photo. While the bar sits over it
  // (top of that page, menu closed) it goes transparent with white content;
  // once scrolled or opened it falls back to the solid surface treatment.
  const overDark = pathname === '/partners' && !scrolled && !open;
  const linkColor = overDark ? 'text-white hover:text-white/75' : 'text-ink hover:text-brand';

  // At the very top the bar is transparent so it sits on whatever section is
  // behind it (the blue partner hero, the light home hero); once the user
  // scrolls it fades to the solid surface so content stays legible underneath.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close on Escape, and lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-colors duration-300 ${
        open
          ? 'border-b border-black/[0.04] bg-surface'
          : scrolled
            ? 'border-b border-black/[0.04] bg-surface/85 backdrop-blur-md'
            : 'border-b border-transparent bg-transparent'
      }`}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-[1440px] items-center justify-between px-[18px] py-3 sm:px-6 sm:py-[18px] lg:px-12 xl:px-[110px] xl:py-[22px]"
      >
        {/* Brand */}
        <Link href="/" aria-label="Theraptly home" className={`rounded-md ${focusRing}`}>
          <Logo
            wordmarkClassName={overDark ? 'text-white' : 'text-ink-strong'}
            markClassName={overDark ? 'text-white' : undefined}
          />
        </Link>

        {/* Desktop links + actions */}
        <div className="hidden items-center gap-6 lg:flex xl:gap-[34px]">
          <ul className="flex items-center gap-8 rounded-[60px] px-6 py-3 xl:gap-16 xl:px-8">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className={`flex items-center gap-2 rounded-md px-1 py-0.5 text-[15px] font-medium leading-[18px] transition-colors ${linkColor} ${focusRing}`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <Button href="/login" variant="white" size="sm">
              Sign in
            </Button>
            <Button href="/request-demo" variant="brand" size="sm">
              Request a Demo
            </Button>
          </div>
        </div>

        {/* Mobile toggle */}
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className={`relative z-50 flex size-10 items-center justify-center rounded-lg transition-colors lg:hidden ${
            overDark ? 'text-white hover:bg-white/10' : 'text-ink hover:bg-black/[0.04]'
          } ${focusRing}`}
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <span className="relative block h-4 w-5" aria-hidden="true">
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${
                open ? 'top-1/2 -translate-y-1/2 rotate-45' : 'top-0'
              }`}
            />
            <span
              className={`absolute left-0 top-1/2 block h-0.5 w-5 -translate-y-1/2 rounded-full bg-current transition-all duration-200 ${
                open ? 'opacity-0' : 'opacity-100'
              }`}
            />
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${
                open ? 'top-1/2 -translate-y-1/2 -rotate-45' : 'bottom-0'
              }`}
            />
          </span>
        </button>
      </nav>

      {/* Mobile menu overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile menu panel */}
      <div
        id="mobile-nav"
        ref={panelRef}
        className={`fixed inset-x-0 top-[70px] z-40 origin-top overflow-hidden border-b border-black/[0.06] bg-surface px-[18px] shadow-lg transition-all duration-300 ease-out lg:hidden ${
          open
            ? 'visible max-h-[80vh] translate-y-0 py-6 opacity-100'
            : 'invisible max-h-0 -translate-y-2 py-0 opacity-0'
        }`}
      >
        <ul className="flex flex-col gap-1">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-3 py-3 text-[16px] font-medium text-ink transition-colors hover:bg-black/[0.04] ${focusRing}`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-col gap-3 border-t border-black/[0.06] pt-4">
          <Button href="/login" variant="white" size="md" fullWidth onClick={() => setOpen(false)}>
            Sign in
          </Button>
          <Button
            href="/request-demo"
            variant="brand"
            size="md"
            fullWidth
            onClick={() => setOpen(false)}
          >
            Request a Demo
          </Button>
        </div>
      </div>
    </header>
  );
}
