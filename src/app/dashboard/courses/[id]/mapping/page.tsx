import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getMappingSuggestions } from '@/app/actions/mapping';
import MappingCard from './mapping-card';

export default async function MappingPage({ params }: { params: Promise<{ id: string }> }) {
  await auth();
  const { id } = await params;

  // We ideally need the text content.
  // Flow: Course -> DocumentVersion -> Content
  const course = await prisma.course.findUnique({
    where: { id },
    include: { versions: { include: { documentVersion: true } } },
  });

  if (!course || !course.versions.length) {
    return <div>Course not found or no content.</div>;
  }

  const docVersion = course.versions[0].documentVersion; // simplified
  const content = docVersion.content || 'No text content extracted.';

  // Mock getting suggestions (Server Side for initial render or simple display)
  const suggestions = await getMappingSuggestions(content.substring(0, 500)); // Sample first 500 chars

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
