/**
 * Status now describes the UPLOAD, not the course pipeline: "In progress" while
 * a file's bytes are still going up, "Completed" once it is persisted. The old
 * Uploaded/Converted-to-Course pair is gone from the list; "Converted to Course"
 * survives as detail-page-only wording.
 */
import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_CONVERTED_LABEL,
  type DocumentLifecycleStatus,
} from './status';

describe('DOCUMENT_STATUS_LABELS', () => {
  it('provides the exact upload-lifecycle copy the list renders', () => {
    expect(DOCUMENT_STATUS_LABELS.in_progress).toBe('In progress');
    expect(DOCUMENT_STATUS_LABELS.completed).toBe('Completed');
  });

  it('has a label for every lifecycle status', () => {
    const statuses: DocumentLifecycleStatus[] = ['in_progress', 'completed'];
    for (const status of statuses) {
      expect(DOCUMENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('carries no course-pipeline status — that is not what Status means any more', () => {
    expect(Object.keys(DOCUMENT_STATUS_LABELS).sort()).toEqual(['completed', 'in_progress']);
    expect(Object.values(DOCUMENT_STATUS_LABELS)).not.toContain('Converted to Course');
  });
});

describe('DOCUMENT_CONVERTED_LABEL', () => {
  it('keeps the converted-to-course wording for the document detail page', () => {
    expect(DOCUMENT_CONVERTED_LABEL).toBe('Converted to Course');
  });
});
