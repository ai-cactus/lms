/**
 * Shared document-lifecycle status vocabulary.
 *
 * Status describes the UPLOAD, not the downstream course pipeline: a document
 * is "In progress" only while its bytes are still being uploaded (a client-side
 * state the list shows optimistically), and "Completed" once it is persisted.
 * Every document the server returns is therefore completed by definition.
 *
 * Whether a document went on to generate a course is a separate fact, surfaced
 * on the document detail page only — see `DOCUMENT_CONVERTED_LABEL`.
 */
export type DocumentLifecycleStatus = 'in_progress' | 'completed';

export const DOCUMENT_STATUS_LABELS: Record<DocumentLifecycleStatus, string> = {
  in_progress: 'In progress',
  completed: 'Completed',
};

/** Detail-page-only wording for a document that has generated a course. */
export const DOCUMENT_CONVERTED_LABEL = 'Converted to Course';
