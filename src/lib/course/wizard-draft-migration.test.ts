/**
 * Tests for the `_v3` -> `_v4` course-wizard draft migration (D1): the payload
 * bump that narrows `formData.modules[]` to a document reference.
 *
 * `migrateWizardDraftV3ToV4` is pure and is only ever exercised when a
 * generation is genuinely pending — see the module docstring for why: dropping
 * the draft mid-generation orphans a paid Vertex run that `useMultiJobStatus`
 * would otherwise resume polling for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateWizardDraftV3ToV4, runWizardDraftMigration } from './wizard-draft-migration';

const V3_KEY = 'lms_course_wizard_draft_v3';
const V4_KEY = 'lms_course_wizard_draft_v4';

function v3Draft(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    stepKey: 'generate',
    generatedContent: null,
    savedAt: 1234567890,
    formData: {
      title: 'HIPAA Training',
      modules: [
        {
          title: 'Privacy Rule',
          objective: 'Explain PHI handling',
          completionDeadlineDays: 5,
          documentId: 'doc-1',
          fileName: 'privacy.pdf',
          fileSize: 12345,
          mimeType: 'application/pdf',
        },
        {
          title: 'Security Rule',
          objective: 'Explain safeguards',
          completionDeadlineDays: 7,
          documentId: 'doc-2',
          fileName: 'security.pdf',
          fileSize: 6789,
          mimeType: 'application/pdf',
        },
      ],
      ...overrides,
    },
  });
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('migrateWizardDraftV3ToV4', () => {
  it('narrows a 2-module v3 draft to its document fields, preserving the rest', () => {
    const migrated = migrateWizardDraftV3ToV4(v3Draft(), true);

    expect(migrated).not.toBeNull();
    const parsed = JSON.parse(migrated as string);

    expect(parsed.stepKey).toBe('generate');
    expect(parsed.generatedContent).toBeNull();
    expect(parsed.savedAt).toBe(1234567890);
    expect(parsed.formData.title).toBe('HIPAA Training');
    expect(parsed.formData.modules).toEqual([
      {
        documentId: 'doc-1',
        fileName: 'privacy.pdf',
        fileSize: 12345,
        mimeType: 'application/pdf',
      },
      {
        documentId: 'doc-2',
        fileName: 'security.pdf',
        fileSize: 6789,
        mimeType: 'application/pdf',
      },
    ]);
    // No leftover title/objective/completionDeadlineDays on the narrowed modules.
    expect(parsed.formData.modules[0]).not.toHaveProperty('title');
    expect(parsed.formData.modules[0]).not.toHaveProperty('objective');
    expect(parsed.formData.modules[0]).not.toHaveProperty('completionDeadlineDays');
  });

  it('discards the draft when no generation is pending', () => {
    expect(migrateWizardDraftV3ToV4(v3Draft(), false)).toBeNull();
  });

  it('discards when there is no raw draft at all', () => {
    expect(migrateWizardDraftV3ToV4(null, true)).toBeNull();
  });

  it('never throws on unparseable JSON — returns null', () => {
    expect(() => migrateWizardDraftV3ToV4('{not json', true)).not.toThrow();
    expect(migrateWizardDraftV3ToV4('{not json', true)).toBeNull();
  });

  it('treats a non-object payload as malformed', () => {
    expect(migrateWizardDraftV3ToV4('42', true)).toBeNull();
    expect(migrateWizardDraftV3ToV4('null', true)).toBeNull();
    expect(migrateWizardDraftV3ToV4('"a string"', true)).toBeNull();
  });

  it('treats a draft with no formData object as malformed', () => {
    expect(migrateWizardDraftV3ToV4(JSON.stringify({ stepKey: 'quiz' }), true)).toBeNull();
    expect(
      migrateWizardDraftV3ToV4(JSON.stringify({ stepKey: 'quiz', formData: 'oops' }), true),
    ).toBeNull();
  });

  it('migrates a missing modules array to [], not treating it as malformed', () => {
    const raw = JSON.stringify({ stepKey: 'quiz', formData: { title: 'No modules yet' } });

    const migrated = migrateWizardDraftV3ToV4(raw, true);

    expect(migrated).not.toBeNull();
    expect(JSON.parse(migrated as string).formData.modules).toEqual([]);
  });

  it('migrates a non-array modules field to [], not treating it as malformed', () => {
    const raw = JSON.stringify({ stepKey: 'quiz', formData: { modules: { not: 'an array' } } });

    const migrated = migrateWizardDraftV3ToV4(raw, true);

    expect(migrated).not.toBeNull();
    expect(JSON.parse(migrated as string).formData.modules).toEqual([]);
  });

  it('drops a module entry that is not itself an object', () => {
    const raw = JSON.stringify({
      stepKey: 'quiz',
      formData: { modules: [null, 'not-an-object', { documentId: 'doc-1' }] },
    });

    const migrated = migrateWizardDraftV3ToV4(raw, true);

    expect(JSON.parse(migrated as string).formData.modules).toEqual([{ documentId: 'doc-1' }]);
  });

  it('narrows a module with a null documentId and no file metadata', () => {
    const raw = JSON.stringify({
      stepKey: 'quiz',
      formData: { modules: [{ documentId: null, title: 'Untitled' }] },
    });

    const migrated = migrateWizardDraftV3ToV4(raw, true);

    expect(JSON.parse(migrated as string).formData.modules).toEqual([{ documentId: null }]);
  });
});

describe('runWizardDraftMigration', () => {
  it('writes the migrated v4 draft and removes v3 when v4 is empty', () => {
    sessionStorage.setItem(V3_KEY, v3Draft());

    runWizardDraftMigration({ v3Key: V3_KEY, v4Key: V4_KEY, hasPendingGeneration: true });

    expect(sessionStorage.getItem(V3_KEY)).toBeNull();
    const v4 = sessionStorage.getItem(V4_KEY);
    expect(v4).not.toBeNull();
    expect(JSON.parse(v4 as string).formData.modules).toEqual([
      {
        documentId: 'doc-1',
        fileName: 'privacy.pdf',
        fileSize: 12345,
        mimeType: 'application/pdf',
      },
      {
        documentId: 'doc-2',
        fileName: 'security.pdf',
        fileSize: 6789,
        mimeType: 'application/pdf',
      },
    ]);
  });

  it('removes v3 unconditionally even when there is nothing to migrate', () => {
    sessionStorage.setItem(V3_KEY, v3Draft());

    runWizardDraftMigration({ v3Key: V3_KEY, v4Key: V4_KEY, hasPendingGeneration: false });

    expect(sessionStorage.getItem(V3_KEY)).toBeNull();
    expect(sessionStorage.getItem(V4_KEY)).toBeNull();
  });

  it('an existing v4 draft always wins over a migrated one', () => {
    sessionStorage.setItem(V3_KEY, v3Draft());
    sessionStorage.setItem(V4_KEY, JSON.stringify({ formData: { modules: [] }, fromBuild: 'v4' }));

    runWizardDraftMigration({ v3Key: V3_KEY, v4Key: V4_KEY, hasPendingGeneration: true });

    expect(sessionStorage.getItem(V3_KEY)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(V4_KEY) as string).fromBuild).toBe('v4');
  });

  it('does nothing when there is no v3 draft to migrate', () => {
    runWizardDraftMigration({ v3Key: V3_KEY, v4Key: V4_KEY, hasPendingGeneration: true });

    expect(sessionStorage.getItem(V3_KEY)).toBeNull();
    expect(sessionStorage.getItem(V4_KEY)).toBeNull();
  });

  it('must not throw when sessionStorage is unavailable (private browsing)', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(() =>
      runWizardDraftMigration({ v3Key: V3_KEY, v4Key: V4_KEY, hasPendingGeneration: true }),
    ).not.toThrow();

    getItemSpy.mockRestore();
  });

  it('must not throw when sessionStorage.setItem throws (quota exceeded)', () => {
    sessionStorage.setItem(V3_KEY, v3Draft());
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    expect(() =>
      runWizardDraftMigration({ v3Key: V3_KEY, v4Key: V4_KEY, hasPendingGeneration: true }),
    ).not.toThrow();

    setItemSpy.mockRestore();
  });
});
