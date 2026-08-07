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
  };
  const prismaMock = {
    $transaction: vi.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
    _tx: txClient,
    // Uploader lookup that feeds the post-upload notification's facility + name —
    // now resolved via the OrganizationUser row, not a flat User.
    organizationUser: { findUnique: vi.fn() },
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

import {
  uploadDocument,
  uploadDocuments,
  getDocuments,
  renameDocument,
  deleteDocument,
} from './documents';
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
  mockAuth.mockResolvedValue({
    user: { id: 'user-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'owner' },
  });
  mockExtractTextFromFile.mockResolvedValue('some extracted document text');
  mockCalculateHash.mockResolvedValue('hash-abc');
  mockSaveFile.mockResolvedValue('gcs://bucket/policy.pdf');
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetInSeconds: 300 });
  prismaMock.organizationUser.findUnique.mockResolvedValue({
    user: { fullName: 'Ada Owner' },
    facilities: [{ facilityId: 'facility-1' }],
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

  it('proceeds to storage + DB persistence for a clean (no PHI, scan succeeded) document', async () => {
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    prismaMock._tx.document.create.mockResolvedValue({ id: 'doc-1' });
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });

    const result = await uploadDocument(null, makeFormData());

    expect(mockSaveFile).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: true, phiDetected: false });
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
    mockAuth.mockResolvedValue({
      user: { id: 'fin-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'finance' },
    });

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({ error: 'You do not have permission to upload documents.' });
    expect(mockExtractTextFromFile).not.toHaveBeenCalled();
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  // RBAC ruling: HR now holds full document CRUD (document.create/read/edit/
  // delete), not just document.read — updated from the prior "HR is read-only
  // on documents" assumption.
  it('allows uploadDocument for role=hr (full document CRUD per RBAC ruling)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'hr' },
    });
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    prismaMock._tx.document.create.mockResolvedValue({ id: 'doc-1' });
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });

    const result = await uploadDocument(null, makeFormData());

    expect(result).toEqual({ success: true, phiDetected: false });
  });

  it('allows uploadDocument for role=clinical_director (full document access)', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'cd-1',
        organizationId: 'org-1',
        organizationUserId: 'ou-1',
        role: 'clinical_director',
      },
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
    mockAuth.mockResolvedValue({
      user: { id: 'fin-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'finance' },
    });

    const result = await getDocuments();

    expect(result).toEqual([]);
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  it('allows getDocuments for role=hr (document.read granted)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'hr' },
    });
    prismaMock.document.findMany.mockResolvedValue([]);

    await getDocuments();

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationUser: { organizationId: 'org-1' } } }),
    );
  });

  // RBAC ruling: HR now holds document.delete too (full document CRUD),
  // superseding the prior "HR loses delete/rename" assumption.
  it('allows deleteDocument for role=hr (full document CRUD per RBAC ruling)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'hr' },
    });
    prismaMock.document.findUnique.mockResolvedValue({
      organizationUser: { organizationId: 'org-1' },
      versions: [],
    });
    prismaMock.document.delete.mockResolvedValue({});

    const result = await deleteDocument('doc-1');

    expect(result).toEqual({ success: true });
  });

  // RBAC ruling: HR now holds document.edit too (full document CRUD),
  // superseding the prior "HR loses delete/rename" assumption.
  it('allows renameDocument for role=hr (full document CRUD per RBAC ruling)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'hr-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'hr' },
    });
    prismaMock.document.findUnique.mockResolvedValue({
      organizationUser: { organizationId: 'org-1' },
    });
    prismaMock.document.update.mockResolvedValue({});

    const result = await renameDocument('doc-1', 'New Name.pdf');

    expect(result).toEqual({ success: true });
  });

  it('denies deleteDocument for role=finance (no document.delete)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'fin-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'finance' },
    });

    const result = await deleteDocument('doc-1');

    expect(result).toEqual({ error: 'Document not found' });
    expect(prismaMock.document.findUnique).not.toHaveBeenCalled();
  });

  it('allows deleteDocument/renameDocument for role=clinical_director (full document access)', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'cd-1',
        organizationId: 'org-1',
        organizationUserId: 'ou-1',
        role: 'clinical_director',
      },
    });
    prismaMock.document.findUnique.mockResolvedValue({
      organizationUser: { organizationId: 'org-1' },
    });
    prismaMock.document.update.mockResolvedValue({});

    const result = await renameDocument('doc-1', 'New Name.pdf');

    expect(result).toEqual({ success: true });
  });
});

describe('Document Hub — full org parity (getDocuments/renameDocument/deleteDocument)', () => {
  const ORG_A_ADMIN = {
    user: { id: 'admin-a1', organizationId: 'org-a', organizationUserId: 'ou-a1', role: 'owner' },
  };
  // RBAC ruling: supervisor is read-only (no document.edit/delete), so this
  // "different admin in the same org" fixture uses hr (full document CRUD)
  // instead — supervisor would now be correctly denied on rename/delete.
  const ORG_A_ADMIN_2 = {
    user: { id: 'admin-a2', organizationId: 'org-a', organizationUserId: 'ou-a2', role: 'hr' },
  };
  const ORG_B_ADMIN = {
    user: { id: 'admin-b1', organizationId: 'org-b', organizationUserId: 'ou-b1', role: 'owner' },
  };

  describe('getDocuments', () => {
    it('scopes the query by the caller organizationId, not the caller userId', async () => {
      mockAuth.mockResolvedValue(ORG_A_ADMIN);
      prismaMock.document.findMany.mockResolvedValue([]);

      await getDocuments();

      expect(prismaMock.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationUser: { organizationId: 'org-a' } },
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
        organizationUser: { organizationId: 'org-a' }, // uploaded by admin-a1, renamed by admin-a2
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
      prismaMock.document.findUnique.mockResolvedValue({
        organizationUser: { organizationId: 'org-a' },
      });

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
        organizationUser: { organizationId: 'org-a' },
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
        organizationUser: { organizationId: 'org-a' },
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
    prismaMock.organizationUser.findUnique.mockResolvedValue({
      user: { fullName: 'Ada Owner' },
      facilities: [{ facilityId: 'facility-1' }],
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
      user: {
        id: 'user-1',
        organizationId: 'org-1',
        organizationUserId: 'ou-1',
        role: 'owner',
        email: 'ada@acme.com',
      },
    });
    prismaMock.organizationUser.findUnique.mockRejectedValueOnce(new Error('DB unavailable'));

    await uploadDocument(null, makeFormData('policy.pdf'));

    expect(mockEmitNotificationEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        facilityId: null,
        context: expect.objectContaining({ uploaderName: 'ada' }),
      }),
    );
  });
});

describe('uploadDocuments — multi-file batch upload', () => {
  function makeBatchFormData(
    files: Array<{ name: string; type?: string }>,
    opts: { attested?: boolean; category?: string } = {},
  ) {
    const { attested = true, category } = opts;
    const formData = new FormData();
    for (const f of files) {
      formData.append(
        'files',
        new File(['contents'], f.name, { type: f.type ?? 'application/pdf' }),
      );
    }
    if (attested) formData.set('phiAttested', 'true');
    if (category) formData.set('category', category);
    return formData;
  }

  beforeEach(() => {
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    prismaMock._tx.document.findFirst.mockResolvedValue(null);
    let docCounter = 0;
    prismaMock._tx.document.create.mockImplementation(() =>
      Promise.resolve({ id: `doc-${++docCounter}` }),
    );
    prismaMock._tx.documentVersion.create.mockResolvedValue({ id: 'ver-1' });
  });

  it('rejects with no results when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await uploadDocuments(makeBatchFormData([{ name: 'a.pdf' }]));

    expect(result).toEqual({ results: [], error: 'Not authenticated or not in an organization' });
  });

  it('denies a role without document.create (finance) before touching any file', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationId: 'org-1', organizationUserId: 'ou-1', role: 'finance' },
    });

    const result = await uploadDocuments(makeBatchFormData([{ name: 'a.pdf' }]));

    expect(result.results).toEqual([]);
    expect(result.error).toMatch(/permission/i);
    expect(prismaMock._tx.document.create).not.toHaveBeenCalled();
  });

  it('rejects with no results when no files are provided', async () => {
    const result = await uploadDocuments(makeBatchFormData([]));

    expect(result).toEqual({ results: [], error: 'No files provided' });
  });

  it('rejects the whole batch when PHI attestation is missing — authoritative gate applies to the batch surface too', async () => {
    const result = await uploadDocuments(
      makeBatchFormData([{ name: 'a.pdf' }], { attested: false }),
    );

    expect(result).toEqual({
      results: [],
      error: 'You must confirm these documents contain no PHI (Personal Health Information).',
    });
    expect(prismaMock._tx.document.create).not.toHaveBeenCalled();
  });

  it('processes every file sequentially and reports success for each independently', async () => {
    const result = await uploadDocuments(makeBatchFormData([{ name: 'a.pdf' }, { name: 'b.pdf' }]));

    expect(result.results).toEqual([
      { name: 'a.pdf', ok: true, error: undefined },
      { name: 'b.pdf', ok: true, error: undefined },
    ]);
    expect(prismaMock._tx.document.create).toHaveBeenCalledTimes(2);
  });

  it('a file that fails (e.g. unsupported type) is reported in its own row and does not abort the rest of the batch', async () => {
    const result = await uploadDocuments(
      makeBatchFormData([
        { name: 'good.pdf' },
        { name: 'bad.exe', type: 'application/octet-stream' },
        { name: 'also-good.pdf' },
      ]),
    );

    expect(result.results).toEqual([
      { name: 'good.pdf', ok: true, error: undefined },
      { name: 'bad.exe', ok: false, error: 'Only PDF and DOCX files are allowed.' },
      { name: 'also-good.pdf', ok: true, error: undefined },
    ]);
    // Only the two valid files reached persistence.
    expect(prismaMock._tx.document.create).toHaveBeenCalledTimes(2);
  });

  it('a file blocked by the PHI gate is reported ok:false with phiDetected consequence, not thrown', async () => {
    mockScanText
      .mockResolvedValueOnce({ hasPHI: false, findings: [] })
      .mockResolvedValueOnce({ hasPHI: true, findings: [{ type: 'SSN' }] });

    const result = await uploadDocuments(
      makeBatchFormData([{ name: 'clean.pdf' }, { name: 'has-phi.pdf' }]),
    );

    expect(result.results[0]).toEqual({ name: 'clean.pdf', ok: true, error: undefined });
    expect(result.results[1].ok).toBe(false);
    expect(result.results[1].error).toMatch(/PHI/);
  });

  it('stamps the shared category onto every file in the batch', async () => {
    await uploadDocuments(
      makeBatchFormData([{ name: 'a.pdf' }, { name: 'b.pdf' }], { category: 'Policies' }),
    );

    const categories = prismaMock._tx.document.create.mock.calls.map(
      (call) => call[0].data.category,
    );
    expect(categories).toEqual(['Policies', 'Policies']);
  });

  it('stamps a null category when none is provided', async () => {
    await uploadDocuments(makeBatchFormData([{ name: 'a.pdf' }]));

    expect(prismaMock._tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: null }) }),
    );
  });

  it('does not revalidate the documents path when every file in the batch failed', async () => {
    const { revalidatePath } = await import('next/cache');
    vi.mocked(revalidatePath).mockClear();

    const result = await uploadDocuments(
      makeBatchFormData([{ name: 'bad.exe', type: 'application/octet-stream' }]),
    );

    expect(result.results.every((r) => !r.ok)).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('revalidates the documents path when at least one file in the batch succeeded', async () => {
    const { revalidatePath } = await import('next/cache');
    vi.mocked(revalidatePath).mockClear();

    await uploadDocuments(
      makeBatchFormData([
        { name: 'good.pdf' },
        { name: 'bad.exe', type: 'application/octet-stream' },
      ]),
    );

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/documents');
  });
});
