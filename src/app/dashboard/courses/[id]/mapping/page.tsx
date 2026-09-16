import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { requirePermission } from '@/lib/rbac/require-permission';
import { getMappingSuggestions } from '@/app/actions/mapping';
import MappingCard from './mapping-card';

export default async function MappingPage({ params }: { params: Promise<{ id: string }> }) {
  // Was `await auth()` with the result discarded — no role check and no tenancy
  // predicate, so any authenticated session could read any organisation's raw
  // source-document text by typing a course id. The page renders
  // DocumentVersion.content, so it gates on the Document Hub's own permission
  // (`document.read`) rather than `course.read`, which every worker holds.
  const ctx = await requirePermission('document.read', { onDeny: 'notFound' });
  const { id } = await params;

  // Flow: Course -> CourseVersion -> DocumentVersion -> content. Narrowed to the
  // caller's own organisation, so a course id from another tenant is
  // indistinguishable from one that does not exist.
  const course = ctx.organizationId
    ? await prisma.course.findFirst({
        where: { id, creator: { organizationId: ctx.organizationId } },
        include: { versions: { include: { documentVersion: true } } },
      })
    : null;

  if (!course || !course.versions.length) {
    notFound();
  }

  const docVersion = course.versions[0].documentVersion;
  const content = docVersion.content || 'No text content extracted.';

  const suggestions = await getMappingSuggestions(content.substring(0, 500));

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden md:flex-row">
      <div className="flex-1 overflow-y-auto border-b border-border bg-background-secondary p-8 md:border-b-0 md:border-r">
        <h2>Document Content</h2>
        <div className="prose mt-4">
          {content.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6 overflow-y-auto bg-background p-8 md:flex-[0_0_400px]">
        <h2>Compliance Mapping</h2>
        <div className="flex flex-col gap-4">
          <h3>Suggestions</h3>
          {suggestions.map((s, i) => (
            <MappingCard key={i} documentVersionId={docVersion.id} suggestion={s} />
          ))}
        </div>
      </div>
    </div>
  );
}
