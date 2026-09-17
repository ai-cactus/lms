/**
 * The document a course was generated from, as the course-detail page links it.
 *
 * Mirrors `sourceDocumentIdOf` in the courses-list action, including its archive
 * guard: the archive rule is a Prisma client extension on Document's OWN reads
 * and cannot reach a traversal from Course, so an archived source still arrives
 * here. The document viewer refuses it, which would make the link a guaranteed
 * 404 — so an archived source reads as absent, exactly like a course that never
 * had one.
 */
export interface CourseSourceDocument {
  id: string;
  name: string;
}

interface CourseVersionLineage {
  documentVersion: {
    documentId: string;
    document: { originalName: string; archivedAt: Date | null };
  };
}

export function courseSourceDocument(
  versions: CourseVersionLineage[] | null | undefined,
): CourseSourceDocument | null {
  const latest = versions?.[0]?.documentVersion;
  if (!latest || latest.document.archivedAt) return null;
  return { id: latest.documentId, name: latest.document.originalName };
}
