import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from './page.module.css';
import PdfViewer from '@/components/dashboard/documents/PdfViewer';
import { getDocumentSignedUrl } from '@/app/actions/storage';

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

  // Resolve a signed URL for the latest version's file server-side.
  // The signed URL is embedded in the page at render time — valid for 15 min.
  // For legacy local paths this returns the path as-is (backward compat).
  let fileUrl: string | null = null;
  if (doc.mimeType === 'application/pdf') {
    const { url, error } = await getDocumentSignedUrl(latest.id);
    if (url) {
      fileUrl = url;
    } else {
      // Non-fatal: viewer will show an error state if fileUrl is null
      console.error('Could not resolve signed URL for document:', error);
    }
  }

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
          {fileUrl && (
            <a
              href={fileUrl}
              download={doc.filename}
              className={styles.downloadLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              ↓ Download
            </a>
          )}
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
            fileUrl ? (
              <PdfViewer fileUrl={fileUrl} />
            ) : (
              <div className={styles.noContent}>
                <p>Could not load PDF preview.</p>
                <p className={styles.subtext}>The file may have been moved or the link expired.</p>
              </div>
            )
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
