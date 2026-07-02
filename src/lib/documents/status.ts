/**
 * Shared document-lifecycle status vocabulary.
 *
 * The document list and the document detail page both describe where a document
 * sits in its lifecycle. They MUST agree on the same wording, so this helper is
 * the single source of truth: a document is either freshly "Uploaded" or has
 * been "Converted to Course" once at least one course has been generated from
 * (any version of) it.
 */
export type DocumentLifecycleStatus = 'uploaded' | 'converted';

export const DOCUMENT_STATUS_LABELS: Record<DocumentLifecycleStatus, string> = {
  uploaded: 'Uploaded',
  converted: 'Converted to Course',
};

export function deriveDocumentStatus(hasLinkedCourse: boolean): DocumentLifecycleStatus {
  return hasLinkedCourse ? 'converted' : 'uploaded';
}
