/**
 * THER-003 regression tests for uploadDocument's PHI gate.
 *
 * The PHI scanner now always fails CLOSED (see phiScanner.test.ts). This
 * suite guards the action-level consequence of that:
 *   - A document flagged `hasPHI: true` is ALWAYS rejected — regardless of
 *     any env var — with `phiDetected: true` and never reaches storage/DB.
 *   - A scan that could not complete (`scanFailed: true`) is blocked with a
 *     distinct "could not verify" message and never silently saved.
 *   - A clean scan proceeds to storage + DB persistence as before.
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
} = vi.hoisted(() => {
  const txClient = {
    document: { findFirst: vi.fn(), create: vi.fn() },
    documentVersion: { findFirst: vi.fn(), create: vi.fn() },
    phiReport: { create: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
    _tx: txClient,
  };
  return {
    mockAuth: vi.fn(),
    prismaMock,
    mockSaveFile: vi.fn(),
    mockCalculateHash: vi.fn(),
    mockScanText: vi.fn(),
    mockExtractTextFromFile: vi.fn(),
    mockDeleteFile: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/documents/uploadHandler', () => ({ saveFile: mockSaveFile }));
vi.mock('@/lib/documents/versioning', () => ({ calculateHash: mockCalculateHash }));
vi.mock('@/lib/documents/phiScanner', () => ({ scanText: mockScanText }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: mockExtractTextFromFile }));
vi.mock('@/lib/storage', () => ({ deleteFile: mockDeleteFile }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { uploadDocument } from './documents';

function makeFormData(fileName = 'policy.pdf') {
  const formData = new FormData();
  formData.set('file', new File(['contents'], fileName, { type: 'application/pdf' }));
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', organizationId: 'org-1' } });
  mockExtractTextFromFile.mockResolvedValue('some extracted document text');
  mockCalculateHash.mockResolvedValue('hash-abc');
  mockSaveFile.mockResolvedValue('gcs://bucket/policy.pdf');
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
