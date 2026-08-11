/**
 * THER-003 regression tests for uploadDocument's PHI gate, plus Phase 2 Issue
 * #11 (server-side PHI attestation) and the .doc/.docx extension guard.
 *
 * The PHI scanner now always fails CLOSED (see phiScanner.test.ts). This
 * suite guards the action-level consequence of that:
 *   - A document flagged `hasPHI: true` is ALWAYS rejected — regardless of
 *     any env var — with `phiDetected: true` and never reaches storage/DB.
 *   - A scan that could not complete (`scanFailed: true`) is blocked with a
 *     distinct "could not verify" message and never silently saved.
 *   - A clean scan proceeds to storage + DB persistence as before.
 *
 * Every fixture in the PHI-gate suite below sets `phiAttested: 'true'` on the
 * FormData (via `makeFormData`'s default) so those tests exercise the PHI
 * gate specifically, past the attestation check that now runs first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  prismaMock,
  mockSaveFile,
  mockCalculateHash,
  mockScanText,
  mockExtractTextFromFile,
  mockDeleteFile,
  mockCheckRateLimit,
} = vi.hoisted(() => {
  const txClient = {
    document: { findFirst: vi.fn(), create: vi.fn() },
    documentVersion: { findFirst: vi.fn(), create: vi.fn() },
    phiReport: { create: vi.fn() },
    // F-092: the accepted path writes its decision row inside this same
    // transaction, so an accepted document cannot exist without one.
    phiDecision: { create: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
    _tx: txClient,
    // F-092: the BLOCKED paths write their decision row outside any
    // transaction. This must be mocked, not omitted: recordPhiDecision catches
    // its own failures by design, so an unmocked client would let the write
    // fail silently and the assertions below would pass vacuously.
    phiDecision: { create: vi.fn() },
    // Uploader lookup that feeds the post-upload notification's facility + name.
    user: { findUnique: vi.fn() },
    // Top-level `document` methods used by getDocuments/renameDocument/deleteDocument
    // (distinct from `_tx.document`, which is scoped to the uploadDocument transaction).
    document: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return {
    mockAuth: vi.fn(),
    prismaMock,
    mockSaveFile: vi.fn(),
    mockCalculateHash: vi.fn(),
    mockScanText: vi.fn(),
    mockExtractTextFromFile: vi.fn(),
    mockDeleteFile: vi.fn(),
    mockCheckRateLimit: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/documents/uploadHandler', () => ({ saveFile: mockSaveFile }));
vi.mock('@/lib/documents/versioning', () => ({ calculateHash: mockCalculateHash }));
vi.mock('@/lib/documents/phiScanner', () => ({ scanText: mockScanText }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: mockExtractTextFromFile }));
vi.mock('@/lib/storage', () => ({ deleteFile: mockDeleteFile }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
// F-001 audit is a best-effort side-channel — stub it so business-logic tests
// don't depend on the audit sink or the request-scoped headers() it reads.
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// The upload notification is a best-effort side-channel with its own unit tests.
vi.mock('@/lib/notifications/emit', () => ({ emitNotificationEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { uploadDocument, getDocuments, renameDocument, deleteDocument } from './documents';
import { emitNotificationEvent } from '@/lib/notifications/emit';

const mockEmitNotificationEvent = vi.mocked(emitNotificationEvent);

function makeFormData(fileName = 'policy.pdf', opts: { attested?: boolean } = {}) {
  const { attested = true } = opts;
  const formData = new FormData();
  formData.set('file', new File(['contents'], fileName, { type: 'application/pdf' }));
  if (attested) {
    formData.set('phiAttested', 'true');
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', organizationId: 'org-1', role: 'owner' } });
  mockExtractTextFromFile.mockResolvedValue('some extracted document text');
  mockCalculateHash.mockResolvedValue('hash-abc');
  mockSaveFile.mockResolvedValue('gcs://bucket/policy.pdf');
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetInSeconds: 300 });
  prismaMock.user.findUnique.mockResolvedValue({
    facilityId: 'facility-1',
    profile: { fullName: 'Ada Owner' },
  });
  delete process.env.PHI_FAIL_CLOSED;
});

describe('uploadDocument — THER-003 PHI gate always fails closed', () => {
  it('rejects a document with hasPHI: true, regardless of PHI_FAIL_CLOSED env var', async () => {
    process.env.PHI_FAIL_CLOSED = 'false'; // legacy fail-open switch — must have no effect
    mockScanText.mockResolvedValue({ hasPHI: true, findings: [{ type: 'SSN' }] });

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({
      error: 'This document appears to contain PHI (e.g. SSN/DOB/MRN) and cannot be uploaded.',
      phiDetected: true,
    });
    expect(mockSaveFile).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('blocks the upload when the PHI scan itself failed to complete (scanFailed), with a distinct message', async () => {
    mockScanText.mockResolvedValue({ hasPHI: true, scanFailed: true, findings: [] });

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({
      error: 'We could not verify this document for PHI. Please try again in a moment.',
    });
    // Distinct from the genuine-PHI-detected message; must not be flagged phiDetected.
    expect(result.phiDetected).toBeUndefined();
    expect(mockSaveFile).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('blocks the upload with the same "could not verify" message when scanText throws', async () => {
    mockScanText.mockRejectedValue(new Error('Vertex AI unavailable'));

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({
      error: 'We could not verify this document for PHI. Please try again in a moment.',
    });
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  // ─── F-092: the rejection must leave durable evidence ───────────────────
  // A blocked upload creates no DocumentVersion and therefore no PhiReport, so
  // before the phi_decisions ledger existed a rejection's only trace was a
  // stdout warning. "Prove you rejected it" is the question that matters.

  it('records a blocked_phi decision row when PHI is detected', async () => {
    mockScanText.mockResolvedValue({
      hasPHI: true,
      decidedBy: 'local_regex',
      findings: [{ type: 'SSN', offsetStart: 0, offsetEnd: 11, confidence: 1 }],
    });

    await uploadDocument(null, makeFormData());

    expect(prismaMock.phiDecision.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.phiDecision.create.mock.calls[0][0];
    expect(data).toMatchObject({
      source: 'document_upload',
      outcome: 'blocked_phi',
      // A local_regex block means nothing was transmitted to Google at all.
      decidedBy: 'local_regex',
      findingTypes: ['SSN'],
      findingCount: 1,
    });
    // No version row exists for a rejected upload.
    expect(data.documentVersionId).toBeNull();
    // The ledger must not become a store of the thing it rejects.
    expect(data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain('.pdf');
  });

  it('records a blocked_scan_failed decision, distinct from a detection', async () => {
    mockScanText.mockResolvedValue({
      hasPHI: true,
      scanFailed: true,
      findings: [],
      decidedBy: 'ai',
    });

    await uploadDocument(null, makeFormData());

    expect(prismaMock.phiDecision.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.phiDecision.create.mock.calls[0][0];
    // A Vertex outage must not read as a wave of PHI uploads.
    expect(data.outcome).toBe('blocked_scan_failed');
  });

  it('proceeds to storage + DB persistence for a clean (no PHI, scan succeeded) document', async () => {
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [], decidedBy: 'ai' });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    prismaMock._tx.document.create.mockResolvedValue({ id: 'doc-1' });
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });

    const result = await uploadDocument(null, makeFormData());

    expect(mockSaveFile).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: true, phiDetected: false });

    // F-092: the accepted decision is written INSIDE the upload transaction, so
    // it commits or rolls back with the DocumentVersion — an accepted document
    // cannot exist without its decision row. Note it goes to the tx client, not
    // the standalone one, which is what makes it atomic.
    expect(prismaMock._tx.phiDecision.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.phiDecision.create).not.toHaveBeenCalled();

    const { data } = prismaMock._tx.phiDecision.create.mock.calls[0][0];
    expect(data).toMatchObject({
      source: 'document_upload',
      outcome: 'allowed',
      documentVersionId: 'ver-1',
      findingCount: 0,
    });
  });
});

describe('uploadDocument — Issue #11: server-side PHI attestation gate', () => {
  it('rejects when phiAttested is missing from FormData, before any file processing', async () => {
    const result = await uploadDocument(null, makeFormData('policy.pdf', { attested: false }));

    expect(result).toEqual({
      error: 'You must confirm this document contains no PHI (Personal Health Information).',
    });
    // Fails fast — never reaches text extraction, the PHI scan, or storage.
    expect(mockExtractTextFromFile).not.toHaveBeenCalled();
    expect(mockScanText).not.toHaveBeenCalled();
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it('rejects when phiAttested is present but not the string "true"', async () => {
    const formData = new FormData();
    formData.set('file', new File(['contents'], 'policy.pdf', { type: 'application/pdf' }));
    formData.set('phiAttested', 'false');

    const result = await uploadDocument(null, formData);

    expect(result.error).toBe(
      'You must confirm this document contains no PHI (Personal Health Information).',
    );
    expect(mockSaveFile).not.toHaveBeenCalled();
  });
});

describe('uploadDocument — Issue #13: .doc/.docx server-side extension guard', () => {
  it('rejects a legacy .doc file by extension even when the client spoofs an allowed MIME type', async () => {
    const formData = new FormData();
    // application/msword is the real .doc MIME type — must not be admitted.
    formData.set('file', new File(['contents'], 'policy.doc', { type: 'application/msword' }));
    formData.set('phiAttested', 'true');

    const result = await uploadDocument(null, formData);

    expect(result).toEqual({ error: 'Only PDF and DOCX files are allowed.' });
    expect(mockExtractTextFromFile).not.toHaveBeenCalled();
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it('rejects a .doc file with no/unrecognized MIME type on extension alone', async () => {
    const formData = new FormData();
    // Some browsers/OSes send an empty MIME type for legacy .doc files; the
    // extension-regex signal must independently catch this.
    formData.set('file', new File(['contents'], 'policy.doc', { type: '' }));
    formData.set('phiAttested', 'true');

    const result = await uploadDocument(null, formData);

    expect(result).toEqual({ error: 'Only PDF and DOCX files are allowed.' });
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  // The extension is authoritative: a .doc file whose declared MIME type is
  // spoofed as an allowed value (e.g. 'application/pdf') must still be rejected,
  // because both signals must agree and the extension arm fails.
  it('rejects a .doc file with a spoofed application/pdf MIME type (extension is authoritative)', async () => {
    const formData = new FormData();
    formData.set('file', new File(['contents'], 'policy.doc', { type: 'application/pdf' }));
    formData.set('phiAttested', 'true');

    const result = await uploadDocument(null, formData);

    expect(result).toEqual({ error: 'Only PDF and DOCX files are allowed.' });
    expect(mockExtractTextFromFile).not.toHaveBeenCalled();
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it('accepts a real .docx file', async () => {
    const formData = new FormData();
    formData.set(
      'file',
      new File(['contents'], 'policy.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    formData.set('phiAttested', 'true');
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    prismaMock._tx.document.create.mockResolvedValue({ id: 'doc-1' });
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });

    const result = await uploadDocument(null, formData);

    expect(result).toEqual({ success: true, phiDetected: false });
  });
});

describe('Document Hub — per-role registry gate (RBAC billing+documents tightening)', () => {
  // Regression: uploadDocument previously had NO role gate at all — Finance
  // uploaded documents live on staging. It now requires `document.create`,
  // which Finance is not granted (Finance has no document.* permissions).
  it('denies uploadDocument for role=finance (regression: was live-exploitable)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'fin-1', organizationId: 'org-1', role: 'finance' } });

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({ error: 'You do not have permission to upload documents.' });
    expect(mockExtractTextFromFile).not.toHaveBeenCalled();
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  // HR has document.read only (invites/roster/compliance-metrics manager) — it
  // is NOT granted document.create, so it stays read-only on the Document Hub.
  it('denies uploadDocument for role=hr (document.read only, no document.create)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'hr-1', organizationId: 'org-1', role: 'hr' } });

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({ error: 'You do not have permission to upload documents.' });
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it('allows uploadDocument for role=clinical_director (full document access)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'cd-1', organizationId: 'org-1', role: 'clinical_director' },
    });
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    prismaMock._tx.document.create.mockResolvedValue({ id: 'doc-1' });
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({ success: true, phiDetected: false });
  });

  // Finance has no document.* permission at all (not even read) — the
  // Document Hub must be entirely invisible to it.
  it('returns [] for getDocuments with role=finance, without querying the database', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'fin-1', organizationId: 'org-1', role: 'finance' } });

    const result = await getDocuments();

    expect(result).toEqual([]);
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  // HR keeps read-only Document Hub access (document.read) but is not granted
  // document.delete or document.edit — it must lose delete/rename.
  it('allows getDocuments for role=hr (document.read granted)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'hr-1', organizationId: 'org-1', role: 'hr' } });
    prismaMock.document.findMany.mockResolvedValue([]);

    await getDocuments();

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { organizationId: 'org-1' } } }),
    );
  });

  it('denies deleteDocument for role=hr (no document.delete) without querying the document', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'hr-1', organizationId: 'org-1', role: 'hr' } });

    const result = await deleteDocument('doc-1');

    expect(result).toEqual({ error: 'Document not found' });
    expect(prismaMock.document.findUnique).not.toHaveBeenCalled();
  });

  it('denies renameDocument for role=hr (no document.edit) without querying the document', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'hr-1', organizationId: 'org-1', role: 'hr' } });

    const result = await renameDocument('doc-1', 'New Name.pdf');

    expect(result).toEqual({ error: 'Document not found' });
    expect(prismaMock.document.findUnique).not.toHaveBeenCalled();
  });

  it('denies deleteDocument for role=finance (no document.delete)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'fin-1', organizationId: 'org-1', role: 'finance' } });

    const result = await deleteDocument('doc-1');

    expect(result).toEqual({ error: 'Document not found' });
    expect(prismaMock.document.findUnique).not.toHaveBeenCalled();
  });

  it('allows deleteDocument/renameDocument for role=clinical_director (full document access)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'cd-1', organizationId: 'org-1', role: 'clinical_director' },
    });
    prismaMock.document.findUnique.mockResolvedValue({ user: { organizationId: 'org-1' } });
    prismaMock.document.update.mockResolvedValue({});

    const result = await renameDocument('doc-1', 'New Name.pdf');

    expect(result).toEqual({ success: true });
  });
});

describe('Document Hub — full org parity (getDocuments/renameDocument/deleteDocument)', () => {
  const ORG_A_ADMIN = { user: { id: 'admin-a1', organizationId: 'org-a', role: 'owner' } };
  const ORG_A_ADMIN_2 = { user: { id: 'admin-a2', organizationId: 'org-a', role: 'supervisor' } };
  const ORG_B_ADMIN = { user: { id: 'admin-b1', organizationId: 'org-b', role: 'owner' } };

  describe('getDocuments', () => {
    it('scopes the query by the caller organizationId, not the caller userId', async () => {
      mockAuth.mockResolvedValue(ORG_A_ADMIN);
      prismaMock.document.findMany.mockResolvedValue([]);

      await getDocuments();

      expect(prismaMock.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user: { organizationId: 'org-a' } },
        }),
      );
    });

    it('returns [] for a non-admin caller without querying the database', async () => {
      mockAuth.mockResolvedValue({
        user: { id: 'worker-a1', organizationId: 'org-a', role: 'nurse' },
      });

      const result = await getDocuments();

      expect(result).toEqual([]);
      expect(prismaMock.document.findMany).not.toHaveBeenCalled();
    });

    it('returns [] when there is no session', async () => {
      mockAuth.mockResolvedValue(null);

      const result = await getDocuments();

      expect(result).toEqual([]);
      expect(prismaMock.document.findMany).not.toHaveBeenCalled();
    });
  });

  describe('renameDocument — any org admin may rename any org document', () => {
    it('renames a document uploaded by a DIFFERENT admin in the same org (full parity)', async () => {
      mockAuth.mockResolvedValue(ORG_A_ADMIN_2);
      prismaMock.document.findUnique.mockResolvedValue({
        user: { organizationId: 'org-a' }, // uploaded by admin-a1, renamed by admin-a2
      });
      prismaMock.document.update.mockResolvedValue({});

      const result = await renameDocument('doc-1', 'New Name.pdf');

      expect(result).toEqual({ success: true });
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({ filename: 'New Name.pdf' }),
        }),
      );
    });

    it('reports "not found" (never leaking existence) for a document in a different org', async () => {
      mockAuth.mockResolvedValue(ORG_B_ADMIN);
      prismaMock.document.findUnique.mockResolvedValue({ user: { organizationId: 'org-a' } });

      const result = await renameDocument('doc-1', 'New Name.pdf');

      expect(result).toEqual({ error: 'Document not found' });
      expect(prismaMock.document.update).not.toHaveBeenCalled();
    });

    it('rejects an empty filename before querying the document', async () => {
      mockAuth.mockResolvedValue(ORG_A_ADMIN);

      const result = await renameDocument('doc-1', '   ');

      expect(result).toEqual({ error: 'Filename cannot be empty.' });
      expect(prismaMock.document.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('deleteDocument — any org admin may delete any org document', () => {
    it('deletes a document uploaded by a DIFFERENT admin in the same org (full parity)', async () => {
      mockAuth.mockResolvedValue(ORG_A_ADMIN_2);
      prismaMock.document.findUnique.mockResolvedValue({
        user: { organizationId: 'org-a' },
        versions: [{ id: 'ver-1', storagePath: 'gcs://bucket/policy.pdf' }],
      });
      mockDeleteFile.mockResolvedValue(undefined);
      prismaMock.document.delete.mockResolvedValue({});

      const result = await deleteDocument('doc-1');

      expect(result).toEqual({ success: true });
      expect(prismaMock.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
    });

    it('reports "not found" for a document in a different org and never deletes it', async () => {
      mockAuth.mockResolvedValue(ORG_B_ADMIN);
      prismaMock.document.findUnique.mockResolvedValue({
        user: { organizationId: 'org-a' },
        versions: [],
      });

      const result = await deleteDocument('doc-1');

      expect(result).toEqual({ error: 'Document not found' });
      expect(prismaMock.document.delete).not.toHaveBeenCalled();
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('rejects a non-admin caller before any lookup', async () => {
      mockAuth.mockResolvedValue({
        user: { id: 'worker-a1', organizationId: 'org-a', role: 'nurse' },
      });

      const result = await deleteDocument('doc-1');

      expect(result).toEqual({ error: 'Document not found' });
      expect(prismaMock.document.findUnique).not.toHaveBeenCalled();
    });
  });
});

describe('uploadDocument — DOCUMENT_UPLOADED notification wiring', () => {
  it('emits DOCUMENT_UPLOADED with the uploader as actor, their facility, and the file name in context', async () => {
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    prismaMock._tx.document.create.mockResolvedValue({ id: 'doc-1' });
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });
    prismaMock.user.findUnique.mockResolvedValue({
      facilityId: 'facility-1',
      profile: { fullName: 'Ada Owner' },
    });

    await uploadDocument(null, makeFormData('policy.pdf'));

    expect(mockEmitNotificationEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        organizationId: 'org-1',
        type: 'DOCUMENT_UPLOADED',
        actor: { userId: 'user-1', role: 'owner' },
        facilityId: 'facility-1',
        context: expect.objectContaining({
          documentTitle: 'policy.pdf',
          uploaderName: 'Ada Owner',
        }),
      }),
    );
  });

  it('falls back to the email-prefix name and a null facilityId when the uploader lookup fails', async () => {
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    prismaMock._tx.document.create.mockResolvedValue({ id: 'doc-1' });
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationId: 'org-1', role: 'owner', email: 'ada@acme.com' },
    });
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error('DB unavailable'));

    await uploadDocument(null, makeFormData('policy.pdf'));

    expect(mockEmitNotificationEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        facilityId: null,
        context: expect.objectContaining({ uploaderName: 'ada' }),
      }),
    );
  });
});
