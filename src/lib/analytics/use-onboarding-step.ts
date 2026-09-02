'use client';

import { useCallback, useEffect, useRef } from 'react';
import { capture } from '@/lib/analytics/client';

/**
 * Instruments one step of the onboarding wizard.
 *
 * The wizard is the clearest funnel in the product and the place a new customer
 * is most likely to abandon, so both halves matter: `viewed` gives the
 * denominator (who reached this step) and `completed` the numerator (who got
 * past it). A step with a high view count and a low completion count is where
 * activation is being lost.
 *
 * Timing lives here rather than in each page because five copies of a
 * mount-timestamp ref would drift. The hook is also why the wizard steps are
 * captured CLIENT-side at all: the server sees only the final
 * completeOnboarding() call, so per-step drop-off is invisible to it.
 *
 * @param step 1-indexed wizard step.
 * @returns `captureStepCompleted` — call it once the step's submit succeeds,
 *          NOT on click, so an abandoned validation failure is not counted.
 */
export function useOnboardingStep(step: number): { captureStepCompleted: () => void } {
  // Initialised to 0, not Date.now(): calling a clock during render is impure
  // and React Compiler rejects it. The effect below sets the real value before
  // any completion can be recorded.
  const viewedAt = useRef<number>(0);

  useEffect(() => {
    viewedAt.current = Date.now();
    capture('onboarding_step_viewed', { step });
  }, [step]);

  const captureStepCompleted = useCallback(() => {
    capture('onboarding_step_completed', {
      step,
      // Null rather than a nonsense duration if the effect somehow has not run.
      seconds_on_step: viewedAt.current ? Math.round((Date.now() - viewedAt.current) / 1000) : null,
    });
  }, [step]);

  return { captureStepCompleted };
}
