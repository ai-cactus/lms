import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Download, FileText } from 'lucide-react';
import PdfViewer from '@/components/dashboard/documents/PdfViewerDynamic';
import DocumentDeleteButton from '@/components/dashboard/documents/DocumentDeleteButton';
import { UserProfileMenu } from '@/components/dashboard/NavBar';
import { getDocumentSignedUrl } from '@/app/actions/storage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';
import { can } from '@/lib/rbac/permissions';
import { isAdminRole, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { formatRelativeTime } from '@/lib/utils';

export default async function DocumentViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      organizationUser: { select: { organizationId: true } },
      versions: {
        include: {
          phiReport: true,
          courseVersions: { select: { id: true } },
        },
        orderBy: { version: 'desc' },
      },
    },
  });

  // Org-scoped Document Hub: any org admin may view any document uploaded within
  // their organization. A cross-org document — or any access by a non-admin — is
  // treated as not found so existence is never leaked.
  if (
    !doc ||
    !session?.user?.id ||
    !isAdminRole(session.user.role) ||
    doc.organizationUser.organizationId !== session.user.organizationId
  ) {
    notFound();
  }

  const latest = doc.versions[0];
  const courseLinks = latest.courseVersions || [];
  const hasLinkedCourse = courseLinks.length > 0;
  const canDelete = can(dbRoleToRoleKey(session.user.role), 'document.delete');

  const viewer = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { fullName: true },
  });
  const fullName = viewer?.fullName || session.user.name || session.user.email || 'User';

  // The signed URL is embedded in the page at render time — valid for 15 min.
  // For legacy local paths this returns the path as-is (backward compat).
  const previewUrl = `/api/documents/${latest.id}/preview`;
  const { url: downloadUrl, error: downloadError } = await getDocumentSignedUrl(latest.id);

  if (!downloadUrl) {
    // Non-fatal: the page still renders, just without a download affordance.
    logger.error({
      msg: '[doc] Could not resolve signed URL for document',
      err: downloadError,
      documentId: doc.id,
    });
  }

  const metaBar = (
    <div className="flex flex-wrap items-center justify-center gap-2 border-b border-[#e5e5e5] bg-white px-4 py-3 text-sm text-text-secondary sm:px-6">
      <Badge className="bg-primary/10 px-2.5 py-1 text-[13px] font-semibold text-primary">
        Global
      </Badge>
      <span aria-hidden="true">·</span>
      <span>Uploaded {formatRelativeTime(doc.updatedAt)}</span>
      {latest.phiReport?.hasPHI && (
        <span className="inline-flex items-center rounded-full bg-[#fbe7e7] px-[13px] py-1 text-[13px] font-semibold text-[#e13737]">
          PHI Detected
        </span>
      )}
    </div>
  );

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#e5e5e5] bg-white px-4 py-3 sm:px-6">
        <Link
          href="/dashboard/documents"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#0d0d12] transition-colors hover:bg-background-secondary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Documents
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileText className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[#272b30] sm:text-[19px]">
            {doc.filename}
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {canDelete && (
            <DocumentDeleteButton
              documentId={doc.id}
              filename={doc.filename}
              hasLinkedCourse={hasLinkedCourse}
            />
          )}
          {downloadUrl && (
            <Button asChild size="sm">
              <a
                href={downloadUrl}
                download={doc.filename}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="size-4" aria-hidden="true" />
                Download
              </a>
            </Button>
          )}
          <UserProfileMenu fullName={fullName} />
        </div>
      </header>

      {doc.mimeType === 'application/pdf' ? (
        <PdfViewer fileUrl={previewUrl} meta={metaBar} />
      ) : (
        <>
          <div className="shrink-0">{metaBar}</div>
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            {latest.content ? (
              <div className="mx-auto min-h-full max-w-[900px] rounded-xl border border-[#dfe1e6] bg-white p-4 sm:p-8">
                <pre className="font-sans text-[0.95rem] leading-relaxed whitespace-pre-wrap text-foreground">
                  {latest.content}
                </pre>
              </div>
            ) : (
              <div className="mx-auto flex min-h-[300px] max-w-[900px] flex-col items-center justify-center rounded-xl border border-[#dfe1e6] bg-white p-4 text-text-tertiary sm:p-8">
                <p>Preview not available for this file type.</p>
                <p className="mt-2 text-sm">
                  Only PDF and text-based documents can be previewed here.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
