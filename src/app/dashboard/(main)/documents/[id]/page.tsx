import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import PdfViewer from '@/components/dashboard/documents/PdfViewer';
import { getDocumentSignedUrl } from '@/app/actions/storage';
import { logger } from '@/lib/logger';

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

  // The signed URL is embedded in the page at render time — valid for 15 min.
  // For legacy local paths this returns the path as-is (backward compat).
  let downloadUrl: string | null = null;
  const previewUrl = `/api/documents/${latest.id}/preview`;

  if (doc.mimeType === 'application/pdf') {
    const { url, error } = await getDocumentSignedUrl(latest.id);
    if (url) {
      downloadUrl = url;
    } else {
      // Non-fatal: viewer will show an error state if downloadUrl is null
      logger.error({ msg: 'Could not resolve signed URL for document:', err: error });
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] p-4 sm:p-8">
      <header className="mb-8 border-b border-border pb-6">
        <Link
          href="/dashboard/documents"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to Documents
        </Link>
        <div className="mb-2 flex items-center gap-4">
          <h1 className="text-2xl font-semibold text-foreground">{doc.filename}</h1>
          <span className="rounded bg-background-secondary px-2.5 py-1 text-xs font-semibold text-text-secondary">
            v{latest.version}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-secondary">
          <span>Uploaded: {doc.updatedAt.toLocaleDateString()}</span>
          <span>Size: {(doc.size / 1024).toFixed(1)} KB</span>
          {latest.phiReport?.hasPHI && (
            <span className="rounded bg-error/10 px-2 py-0.5 text-xs text-error">PHI Detected</span>
          )}
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={doc.filename}
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="size-4" aria-hidden="true" /> Download
            </a>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[250px_1fr]">
        <aside className="h-fit rounded-lg bg-bg-secondary p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase text-text-tertiary">Metadata</h3>
          <div className="mb-4">
            <span className="mb-1 block text-xs text-text-secondary">Status</span>
            <div className="text-[0.9rem] font-medium text-foreground">
              {courseLinks.length > 0 ? 'Converted to Course' : 'Uploaded'}
            </div>
          </div>
          {courseLinks.length > 0 && (
            <div className="mb-4">
              <span className="mb-1 block text-xs text-text-secondary">Linked Course</span>
              <span className="text-[0.9rem] font-medium text-foreground">
                {courseLinks[0].course.title}
              </span>
            </div>
          )}
        </aside>

        <div className="min-h-[500px] rounded-lg border border-border bg-white p-8">
          {doc.mimeType === 'application/pdf' ? (
            previewUrl ? (
              <PdfViewer fileUrl={previewUrl} />
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-text-tertiary">
                <p>Could not load PDF preview.</p>
                <p className="mt-2 text-sm">The file may have been moved or the link expired.</p>
              </div>
            )
          ) : latest.content ? (
            <pre className="font-sans text-[0.95rem] leading-relaxed whitespace-pre-wrap text-foreground">
              {latest.content}
            </pre>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center text-text-tertiary">
              <p>Preview not available for this file type.</p>
              <p className="mt-2 text-sm">
                Only PDF and text-based documents can be previewed here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
