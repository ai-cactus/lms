import type { CourseWizardData } from '@/types/course';

/**
 * Contracts and pure helpers for the multi-module generation pipeline: the
 * course wizard starts one v4.6 generation job per module and aggregates the
 * results client-side.
 *
 * Kept out of the `'use server'` action module so the pure parts stay directly
 * unit-testable and importable from client components.
 */

export interface ModuleGenerationRequest {
  /** Position of the module in the wizard — also its position in the course. */
  moduleIndex: number;
  documentId: string;
  title: string;
  objective?: string | null;
  /**
   * Share of the course-level question total this module's quiz should aim for.
   * Omitted on the initial run, where the server distributes the total across
   * the whole batch; a scoped retry passes back the share the module was
   * originally given so the course total stays stable.
   */
  quizQuestionCount?: number;
}

export interface ModuleGenerationJob {
  moduleIndex: number;
  jobId?: string;
  error?: string;
}

/**
 * Splits the course-level "Number of Questions" across modules: every module
 * but the last gets `ceil(total / moduleCount)` and the last absorbs the
 * remainder, so the shares always sum back to `total`.
 *
 * The last share is clamped at zero for the pathological `total < moduleCount`
 * case, where no split can give every module a share AND still sum to the
 * total; the resulting shortfall surfaces as a publish-review quality warning.
 */
export function distributeQuestionCount(total: number, moduleCount: number): number[] {
  if (moduleCount <= 0) return [];

  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  if (moduleCount === 1) return [safeTotal];

  const perModule = Math.ceil(safeTotal / moduleCount);
  const remainder = Math.max(safeTotal - perModule * (moduleCount - 1), 0);

  return [...Array.from({ length: moduleCount - 1 }, () => perModule), remainder];
}

/**
 * Builds the request one module sends to the v4.6 pipeline. Every course-level
 * setting (difficulty, question type, pass mark, notes) is shared by all
 * modules; only the question share, the source document, and the title /
 * description context are per module.
 */
export function buildModuleGenerationFormData(
  courseData: CourseWizardData,
  module: ModuleGenerationRequest,
  quizQuestionCount: number,
): FormData {
  const moduleData: CourseWizardData = {
    ...courseData,
    title: module.title || courseData.title,
    description: module.objective || courseData.description,
    quizQuestionCount: String(quizQuestionCount),
  };

  const formData = new FormData();
  formData.append('data', JSON.stringify(moduleData));
  formData.append('documentId', module.documentId);
  return formData;
}
