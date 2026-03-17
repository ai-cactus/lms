import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from './page.module.css'; // We'll need to create this
import PdfViewer from '@/components/dashboard/documents/PdfViewer';

export default async function DocumentViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      versions: {
        include: {
          phiReport: true,
          courseVersions: { include: { course: true } },
        },
        orderBy: { version: 'desc' },
      },
    },
  });

  if (!doc || doc.userId !== session?.user?.id) {
    notFound();
  }

  const latest = doc.versions[0];
  const courseLinks = latest.courseVersions || [];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/dashboard/documents" className={styles.backLink}>
          ← Back to Documents
        </Link>
        <div className={styles.titleRow}>
          <h1>{doc.filename}</h1>
          <span className={styles.versionBadge}>v{latest.version}</span>
        </div>
        <div className={styles.metaRow}>
          <span>Uploaded: {doc.updatedAt.toLocaleDateString()}</span>
          <span>Size: {(doc.size / 1024).toFixed(1)} KB</span>
          {latest.phiReport?.hasPHI && <span className={styles.badgeWarning}>PHI Detected</span>}
        </div>
      </header>

      <div className={styles.contentWrapper}>
        <div className={styles.sidebar}>
          <h3>Metadata</h3>
          <div className={styles.metaItem}>
            <label>Status</label>
            <div>{courseLinks.length > 0 ? 'Converted to Course' : 'Uploaded'}</div>
          </div>
          {courseLinks.length > 0 && (
            <div className={styles.metaItem}>
              <label>Linked Course</label>
              <Link href={`/dashboard/courses/${courseLinks[0].courseId}`} className={styles.link}>
                {courseLinks[0].course.title}
              </Link>
            </div>
          )}
        </div>

        <div className={styles.mainContent}>
          {doc.mimeType === 'application/pdf' ? (
            <PdfViewer fileUrl={latest.storagePath} />
          ) : latest.content ? (
            <div className={styles.textContent}>
              <pre>{latest.content}</pre>
            </div>
          ) : (
            <div className={styles.noContent}>
              <p>Preview not available for this file type.</p>
              <p className={styles.subtext}>
                Only PDF and text-based documents can be previewed here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
