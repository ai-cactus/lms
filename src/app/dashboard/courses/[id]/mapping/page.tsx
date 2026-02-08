import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import styles from './mapping.module.css';
import { getMappingSuggestions } from '@/app/actions/mapping';
import MappingCard from './mapping-card';

export default async function MappingPage({ params }: { params: { id: string } }) {
    const session = await auth();

    // We ideally need the text content.
    // Flow: Course -> DocumentVersion -> Content
    const course = await prisma.course.findUnique({
        where: { id: params.id },
        include: { versions: { include: { documentVersion: true } } }
    });

    if (!course || !course.versions.length) {
        return <div>Course not found or no content.</div>;
    }

    const docVersion = course.versions[0].documentVersion; // simplified
    const content = docVersion.content || "No text content extracted.";

    // Mock getting suggestions (Server Side for initial render or simple display)
    const suggestions = await getMappingSuggestions(content.substring(0, 500)); // Sample first 500 chars

    return (
        <div className={styles.container}>
            <div className={styles.documentPanel}>
                <h2>Document Content</h2>
                <div className="prose mt-4">
                    {/* Render simplistic view of content */}
                    {content.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                    ))}
                </div>
            </div>

            <div className={styles.standardsPanel}>
                <h2>Compliance Mapping</h2>
                <div className={styles.suggestions}>
                    <h3>Suggestions</h3>
                    {suggestions.map((s, i) => (
                        <MappingCard key={i} documentVersionId={docVersion.id} suggestion={s} />
                    ))}
                </div>
            </div>
        </div>
    );
}
