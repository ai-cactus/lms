/**
 * Classifications offered when uploading to the Document Hub.
 *
 * `Document.category` is a nullable free-form string, so this list drives the
 * picker only — documents uploaded before categories existed, or with the field
 * left blank, stay valid.
 */
export const DOCUMENT_CATEGORIES = [
  'HR',
  'Compliance',
  'Clinical',
  'Operations',
  'Training',
  'Other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
