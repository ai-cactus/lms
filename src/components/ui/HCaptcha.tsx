'use client';

import ReactHCaptcha from '@hcaptcha/react-hcaptcha';
import { cn } from '@/lib/utils';

interface HCaptchaProps {
  /** Called with the verification token once the challenge is solved. */
  onVerify: (token: string) => void;
  /** Called when a previously solved token expires and must be re-solved. */
  onExpire?: () => void;
  /** Called when the widget encounters an error. */
  onError?: (err: string) => void;
  className?: string;
}

// NEXT_PUBLIC_* values are inlined at build time, so these are safe to read here.
const HCAPTCHA_ENABLED = process.env.NEXT_PUBLIC_HCAPTCHA_ENABLED === 'true';
const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;

/**
 * Bot-verification widget (hCaptcha).
 *
 * Renders nothing — and loads no third-party script — unless
 * `NEXT_PUBLIC_HCAPTCHA_ENABLED === 'true'` and a site key is configured, so the
 * feature is fully inert (zero UX change) until ops enable it. The matching
 * server-side check lives in `src/lib/captcha.ts`.
 */
export default function HCaptcha({ onVerify, onExpire, onError, className }: HCaptchaProps) {
  if (!HCAPTCHA_ENABLED || !HCAPTCHA_SITE_KEY) {
    return null;
  }

  return (
    <div className={cn('flex justify-center', className)}>
      <ReactHCaptcha
        sitekey={HCAPTCHA_SITE_KEY}
        onVerify={onVerify}
        onExpire={onExpire}
        onError={onError}
      />
    </div>
  );
}
