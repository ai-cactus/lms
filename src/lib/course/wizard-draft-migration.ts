/**
 * Carries a course-wizard draft across the `_v3` → `_v4` bump that narrowed
 * `formData.modules[]` to a document reference (D1).
 *
 * The bump exists because a `_v3` draft holds modules with `title` / `objective`
 * / `completionDeadlineDays`, which the new shape does not. Wiping it outright
 * would normally be fine — a draft is one admin's unsaved form — except for one
 * case: resuming a generation that is still running needs BOTH halves of the
 * handoff. `pendingJobs` (localStorage) carries the job ids, and the draft
 * (sessionStorage) carries the `formData` and `stepKey` that put the wizard back
 * on the generation step. Drop the draft and the resumed wizard comes back with
 * `data.modules = []`, so `useMultiJobStatus` polls nothing, the interstitial
 * never completes, and a paid Vertex run is orphaned with no way to recover it.
 *
 * So: a `_v3` draft is migrated ONLY when a generation is actually pending.
 * Every other `_v3` draft is discarded as usual.
 */

interface MigratableDraftModule {
  documentId: string | null;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
}

function narrowModule(value: unknown): MigratableDraftModule | null {
  if (typeof value !== 'object' || value === null) return null;
  const stored = value as Record<string, unknown>;

  const documentId = typeof stored.documentId === 'string' ? stored.documentId : null;
  const narrowed: MigratableDraftModule = { documentId };

  if (typeof stored.fileName === 'string') narrowed.fileName = stored.fileName;
  if (typeof stored.fileSize === 'number') narrowed.fileSize = stored.fileSize;
  if (typeof stored.mimeType === 'string') narrowed.mimeType = stored.mimeType;

  return narrowed;
}

/**
 * Rewrites a serialized `_v3` draft into the `_v4` shape.
 *
 * Pure: it takes the raw string and returns the raw string to store, so the
 * decision and the rewrite can be reasoned about (and tested) without storage.
 *
 * Returns `null` — meaning "no draft to carry over", never an exception — when
 * there is no pending generation, when there is no draft, or when the draft is
 * malformed in any way (unparseable, not an object, no `formData` object). A
 * missing or non-array `modules` is not malformed: it migrates to `[]`, which is
 * exactly what an empty upload step looks like.
 */
export function migrateWizardDraftV3ToV4(
  raw: string | null,
  hasPendingGeneration: boolean,
): string | null {
  if (!raw || !hasPendingGeneration) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const draft = parsed as Record<string, unknown>;
    const formData = draft.formData;
    if (typeof formData !== 'object' || formData === null) return null;

    const modules = (formData as Record<string, unknown>).modules;
    const migratedModules = Array.isArray(modules)
      ? modules.map(narrowModule).filter((entry): entry is MigratableDraftModule => !!entry)
      : [];

    return JSON.stringify({
      ...draft,
      formData: { ...(formData as Record<string, unknown>), modules: migratedModules },
    });
  } catch {
    return null;
  }
}

/**
 * Applies {@link migrateWizardDraftV3ToV4} to sessionStorage and then removes
 * the `_v3` key, whether or not anything was carried over.
 *
 * An existing `_v4` draft always wins: it was written by this build, so the
 * migrated one would be the staler of the two.
 */
export function runWizardDraftMigration(options: {
  v3Key: string;
  v4Key: string;
  hasPendingGeneration: boolean;
}): void {
  const { v3Key, v4Key, hasPendingGeneration } = options;

  try {
    const migrated = migrateWizardDraftV3ToV4(sessionStorage.getItem(v3Key), hasPendingGeneration);

    if (migrated && !sessionStorage.getItem(v4Key)) {
      sessionStorage.setItem(v4Key, migrated);
    }

    sessionStorage.removeItem(v3Key);
  } catch {
    // sessionStorage may be unavailable (private browsing). The wizard then
    // starts fresh, which is the same outcome as an unmigratable draft.
  }
}
