/**
 * The wizard's step ladder is the single source of truth the shell derives its
 * counter, progress bar, layout and next/back behaviour from. These tests pin
 * the ladder's shape and its draft-restore fallback, which is what the previous
 * renumbering silently broke: a draft saved under an older ladder resumed on
 * whichever screen happened to sit at its stored index.
 */
import { describe, it, expect } from 'vitest';

import {
  TOTAL_STEPS,
  WIZARD_STEPS,
  getWizardStep,
  stepIndexForKey,
  stepTitle,
  type WizardStepKey,
} from './wizardSteps';

describe('WIZARD_STEPS', () => {
  it('runs the seven steps in creation order', () => {
    expect(WIZARD_STEPS.map((step) => step.key)).toEqual([
      'category',
      'modules',
      'details',
      'quiz',
      'generate',
      'quizReview',
      'assign',
    ]);
    expect(TOTAL_STEPS).toBe(7);
  });

  it('has no gaps: every step is addressable, titled and laid out', () => {
    WIZARD_STEPS.forEach((step, index) => {
      expect(getWizardStep(index)).toBe(step);
      expect(stepIndexForKey(step.key)).toBe(index);
      expect(step.title.trim()).not.toBe('');
      expect(step.columnClass.trim()).not.toBe('');
    });
  });

  it('uses unique keys, so a key always identifies one step', () => {
    expect(new Set(WIZARD_STEPS.map((step) => step.key)).size).toBe(TOTAL_STEPS);
  });

  it('gives the viewport to the generation step alone', () => {
    expect(WIZARD_STEPS.filter((step) => step.ownsViewport).map((step) => step.key)).toEqual([
      'generate',
    ]);
  });
});

describe('next / back at every index', () => {
  // The bounds the shell enforces: Next stops at the publish step, Back at the
  // first (below which it leaves the wizard entirely).
  const next = (index: number) => Math.min(index + 1, TOTAL_STEPS - 1);
  const back = (index: number) => Math.max(index - 1, 0);

  it('walks forward through every step and lands on the publish step', () => {
    let index = 0;
    const visited: WizardStepKey[] = [getWizardStep(index).key];
    while (index < TOTAL_STEPS - 1) {
      index = next(index);
      visited.push(getWizardStep(index).key);
    }

    expect(visited).toEqual(WIZARD_STEPS.map((step) => step.key));
    expect(getWizardStep(index).key).toBe('assign');
  });

  it('walks back to the first step', () => {
    let index = TOTAL_STEPS - 1;
    while (index > 0) index = back(index);

    expect(getWizardStep(index).key).toBe('category');
  });

  it('is symmetric: Back after Next returns to the same step', () => {
    WIZARD_STEPS.forEach((step, index) => {
      if (index === TOTAL_STEPS - 1) return;
      expect(getWizardStep(back(next(index))).key).toBe(step.key);
    });
  });

  it('shows a non-zero progress bar on the first step and a full one on the last', () => {
    const progress = (index: number) => ((index + 1) / TOTAL_STEPS) * 100;

    expect(progress(0)).toBeGreaterThan(0);
    expect(progress(TOTAL_STEPS - 1)).toBe(100);
  });
});

describe('stepIndexForKey — draft restore', () => {
  it('restores a draft saved under a key this ladder still has', () => {
    expect(stepIndexForKey('quizReview')).toBe(5);
  });

  it('falls back to step 1 for a key from an older ladder', () => {
    expect(stepIndexForKey('audience')).toBe(0);
  });

  it('falls back to step 1 for a draft carrying no usable step key', () => {
    expect(stepIndexForKey(undefined)).toBe(0);
    expect(stepIndexForKey(null)).toBe(0);
    // Pre-v3 drafts stored an integer; it must never be read as a position.
    expect(stepIndexForKey(7)).toBe(0);
  });
});

describe('stepTitle', () => {
  it('names the step a validation message points the admin back at', () => {
    expect(stepTitle('generate')).toBe('Course Generation');
  });
});
