import type { CourseWizardData } from '@/types/course';

/**
 * Cross-page handoff for an in-flight course generation: the wizard writes the
 * running jobs before the admin leaves ("Goto Dashboard"), the courses list
 * polls them for its banner, and the wizard resumes them instead of starting a
 * second, duplicate generation.
 */
export const PENDING_GENERATION_KEY = 'lms_pending_generation';

/**
 * Payload version. v1 stored a single `{ jobId, formData }` from the
 * single-document pipeline; v2 stores one job per module. A v1 payload can no
 * longer be resumed, so {@link readPendingGeneration} discards it.
 */
export const PENDING_GENERATION_VERSION = 2;

/** Pending generations older than this are treated as abandoned. */
export const PENDING_GENERATION_MAX_AGE_MS = 60 * 60 * 1000;

export interface PendingGenerationJob {
  moduleIndex: number;
  jobId: string;
}

export interface PendingGeneration {
  version: typeof PENDING_GENERATION_VERSION;
  jobs: PendingGenerationJob[];
  /** Wizard state at the moment the admin left, so the run can be resumed. */
  courseDraft?: CourseWizardData;
  timestamp: number;
}

function isJob(value: unknown): value is PendingGenerationJob {
  if (typeof value !== 'object' || value === null) return false;
  const job = value as Record<string, unknown>;
  return typeof job.moduleIndex === 'number' && typeof job.jobId === 'string' && !!job.jobId;
}

export function clearPendingGeneration(): void {
  try {
    localStorage.removeItem(PENDING_GENERATION_KEY);
  } catch {
    // localStorage may be unavailable (private browsing) — nothing to clear.
  }
}

/**
 * Reads the pending generation, discarding anything that cannot be resumed:
 * unparseable JSON, a payload from an older shape, or one older than
 * `maxAgeMs`. Returns null in every one of those cases so callers never have to
 * defend against a legacy payload.
 */
export function readPendingGeneration(
  maxAgeMs: number = PENDING_GENERATION_MAX_AGE_MS,
): PendingGeneration | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PENDING_GENERATION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPendingGeneration();
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    clearPendingGeneration();
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  const jobs = candidate.jobs;

  if (
    candidate.version !== PENDING_GENERATION_VERSION ||
    !Array.isArray(jobs) ||
    jobs.length === 0 ||
    !jobs.every(isJob) ||
    typeof candidate.timestamp !== 'number'
  ) {
    clearPendingGeneration();
    return null;
  }

  if (Date.now() - candidate.timestamp > maxAgeMs) {
    clearPendingGeneration();
    return null;
  }

  return {
    version: PENDING_GENERATION_VERSION,
    jobs: jobs as PendingGenerationJob[],
    courseDraft: candidate.courseDraft as CourseWizardData | undefined,
    timestamp: candidate.timestamp,
  };
}

export function writePendingGeneration(
  jobs: PendingGenerationJob[],
  courseDraft?: CourseWizardData,
): void {
  if (jobs.length === 0) return;
  try {
    const payload: PendingGeneration = {
      version: PENDING_GENERATION_VERSION,
      jobs,
      courseDraft,
      timestamp: Date.now(),
    };
    localStorage.setItem(PENDING_GENERATION_KEY, JSON.stringify(payload));
  } catch {
    // localStorage may be unavailable (private browsing); the run still
    // completes in this tab, it just cannot be resumed from another page.
  }
}
