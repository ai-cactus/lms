/**
 * The course-creation wizard's step ladder — the single source of truth for how
 * many steps there are, what order they run in, and how each one is laid out.
 *
 * The shell drives itself off a 0-based index into this array rather than a bare
 * integer, so adding, removing or reordering a step is one edit here instead of
 * a renumbering spread across five separate ladders. Steps are addressed by
 * `key`, never by number.
 */

export type WizardStepKey =
  'category' | 'modules' | 'details' | 'quiz' | 'generate' | 'quizReview' | 'assign';

export interface WizardStep {
  key: WizardStepKey;
  /** Human-readable name, used wherever a message needs to point at a step. */
  title: string;
  /**
   * Figma gives each step its own content column. Max widths include the 20px
   * gutter so the inner column lands on the Figma measure (740 / 880 / 1080 /
   * 1200) at 1440px. Steps that end well above the fold also grow to fill the
   * viewport so their nav row sits at the bottom, as in the frames.
   */
  columnClass: string;
  /**
   * The step renders its own full-height layout, so the shell must not wrap it
   * in the shared content column.
   */
  ownsViewport?: boolean;
}

const WIDE_REVIEW_COLUMN = 'max-w-[1240px] pt-10 pb-[60px] md:pt-[90px]';
const STANDARD_COLUMN = 'max-w-[1120px] pt-10 pb-[60px] md:pt-[90px]';

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    key: 'category',
    title: 'Course Category',
    columnClass: 'max-w-[920px] flex-1 justify-between pt-14 pb-[60px] md:pt-[170px] md:pb-[70px]',
  },
  {
    key: 'modules',
    title: 'Course Modules',
    columnClass: 'max-w-[760px] pt-10 pb-[60px] md:pt-[90px]',
  },
  { key: 'details', title: 'Course Details', columnClass: STANDARD_COLUMN },
  { key: 'quiz', title: 'Course Quiz', columnClass: STANDARD_COLUMN },
  {
    key: 'generate',
    title: 'Course Generation',
    columnClass: STANDARD_COLUMN,
    ownsViewport: true,
  },
  { key: 'quizReview', title: 'Review Quiz Questions', columnClass: WIDE_REVIEW_COLUMN },
  { key: 'assign', title: 'Assigning & Publish', columnClass: WIDE_REVIEW_COLUMN },
];

export const TOTAL_STEPS = WIZARD_STEPS.length;

export function getWizardStep(index: number): WizardStep {
  return WIZARD_STEPS[index] ?? WIZARD_STEPS[0];
}

/**
 * Resolves a step key restored from a saved draft. An unknown key belongs to a
 * ladder this build no longer has, so the wizard restarts from the first step
 * rather than landing on whichever screen happens to sit at that position now.
 */
export function stepIndexForKey(key: unknown): number {
  const index = WIZARD_STEPS.findIndex((step) => step.key === key);
  return index === -1 ? 0 : index;
}

export function stepTitle(key: WizardStepKey): string {
  return getWizardStep(stepIndexForKey(key)).title;
}
