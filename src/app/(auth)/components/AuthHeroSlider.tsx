'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { authHeroSlides } from './authHeroSlides';

// framer-motion powers the auth hero animation, which renders on every auth page
// — including /login, the first page an unauthenticated user downloads. Defer the
// animation (and its ~framer-motion chunk) to a browser-only lazy chunk and paint
// a static first slide meanwhile, so the LCP image isn't blocked on the library.
const AuthHeroSliderContent = dynamic(() => import('./AuthHeroSliderContent'), {
  ssr: false,
  loading: () => <AuthHeroSliderFallback />,
});

function AuthHeroSliderFallback() {
  const slide = authHeroSlides[0];
  return (
    <div className="relative hidden h-full lg:w-1/2 xl:w-197.75 2xl:w-1/2 overflow-hidden rounded-3xl bg-[#f7fafc] lg:block">
      <Image
        src={slide.image}
        alt={slide.title}
        fill
        className="pointer-events-none rounded-3xl object-cover"
        priority
        quality={100}
        sizes="(max-width: 1024px) 0vw, 50vw"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-2.5 bg-[linear-gradient(180deg,rgba(16,16,16,0)_53.5%,rgba(16,16,16,1)_100%)] p-10">
        <div className="max-w-135 text-white">
          <h2 className="mb-2.5 text-[32px] font-semibold leading-[1.3]">{slide.title}</h2>
          <p className="text-lg font-normal leading-normal opacity-90">{slide.subtitle}</p>
        </div>
        <div className="flex gap-2">
          {authHeroSlides.map((_, index) => (
            <span
              key={index}
              className={cn('h-1 w-12 rounded bg-white/30', index === 0 && 'bg-white')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AuthHeroSlider() {
  return <AuthHeroSliderContent />;
}
