/**
 * Tier 3 item 5.2 — dynamic-import lazy loading of AuthHeroSlider's
 * framer-motion implementation.
 *
 * AuthHeroSlider now wraps AuthHeroSliderContent in `next/dynamic({ ssr: false })`
 * with a static first-slide `loading` fallback (AuthHeroSliderFallback), so the
 * LCP image on /login isn't blocked behind the framer-motion chunk. The highest
 * regression risk here is the fallback silently regressing to blank/spinner —
 * that would defeat the entire point of the optimization.
 *
 * next/image doesn't render outside Next's own server runtime (verified: a bare
 * react-dom/server renderToString of <Image /> throws "Element type is invalid"
 * because next/image relies on Next's client/server module resolution), so
 * every existing test in this repo that touches AuthHeroSlider mocks next/image.
 * We follow the same convention here.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AuthHeroSlider from './AuthHeroSlider';
import { authHeroSlides } from './authHeroSlides';

vi.mock('next/image', () => ({
  default: ({
    alt,
    priority,
    ...rest
  }: {
    alt: string;
    priority?: boolean;
    [key: string]: unknown;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} data-priority={priority ? 'true' : 'false'} {...rest} />
  ),
}));

describe('AuthHeroSlider — static fallback (LCP guard)', () => {
  it('renders the slide-0 priority image and copy synchronously, before the dynamic import resolves', () => {
    render(<AuthHeroSlider />);

    const image = screen.getByAltText(authHeroSlides[0].title);
    expect(image).toHaveAttribute('src', authHeroSlides[0].image);
    expect(image).toHaveAttribute('data-priority', 'true');
    expect(screen.getByText(authHeroSlides[0].title)).toBeInTheDocument();
    expect(screen.getByText(authHeroSlides[0].subtitle)).toBeInTheDocument();
  });

  it('renders the fallback (static spans), not the interactive framer-motion slider, on first paint', () => {
    render(<AuthHeroSlider />);

    // The fallback (AuthHeroSliderFallback) uses non-interactive <span> dots; only
    // the hydrated AuthHeroSliderContent renders clickable "Go to slide N" buttons.
    // Their absence here confirms the static fallback — not the real content — is
    // what's on screen synchronously.
    expect(screen.queryByRole('button', { name: /go to slide/i })).not.toBeInTheDocument();
  });

  it('renders one dot indicator per slide in the fallback, with only the first marked active', () => {
    const { container } = render(<AuthHeroSlider />);
    const dots = container.querySelectorAll('.rounded.bg-white\\/30, .rounded.bg-white');
    expect(dots).toHaveLength(authHeroSlides.length);
  });
});

describe('AuthHeroSlider — public API preserved', () => {
  it('is still a default export mountable with no props, matching the pre-optimization contract', () => {
    // AuthLayout imports `AuthHeroSlider` as a bare default export and renders it
    // with no props — this must keep working unmodified. Verified implicitly by
    // every other test in this file successfully mounting it, but pinned
    // explicitly here as a regression guard on the module's public shape.
    expect(() => render(<AuthHeroSlider />)).not.toThrow();
  });

  it('eventually hydrates into the interactive framer-motion slider once the lazy chunk resolves', async () => {
    render(<AuthHeroSlider />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /go to slide 1/i })).toBeInTheDocument();
    });

    // All four slide-nav buttons from AuthHeroSliderContent are present post-hydration.
    for (let i = 1; i <= authHeroSlides.length; i++) {
      expect(
        screen.getByRole('button', { name: new RegExp(`go to slide ${i}$`, 'i') }),
      ).toBeInTheDocument();
    }
  });
});
