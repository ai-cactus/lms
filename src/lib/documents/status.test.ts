import { describe, it, expect } from 'vitest';
import { deriveDocumentStatus, DOCUMENT_STATUS_LABELS } from './status';

describe('deriveDocumentStatus', () => {
  it('returns "uploaded" when the document has no linked course', () => {
    expect(deriveDocumentStatus(false)).toBe('uploaded');
  });

  it('returns "converted" when the document has at least one linked course', () => {
    expect(deriveDocumentStatus(true)).toBe('converted');
  });
});

describe('DOCUMENT_STATUS_LABELS', () => {
  it('provides the exact copy shared by the document list and detail page', () => {
    expect(DOCUMENT_STATUS_LABELS.uploaded).toBe('Uploaded');
    expect(DOCUMENT_STATUS_LABELS.converted).toBe('Converted to Course');
  });

  it('has a label for every possible deriveDocumentStatus() output', () => {
    const outputs = [deriveDocumentStatus(true), deriveDocumentStatus(false)] as const;
    for (const status of outputs) {
      expect(DOCUMENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});
