import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requirePermission } from '@/lib/rbac/require-permission';
import { can } from '@/lib/rbac/permissions';
import { getDocumentCategories } from '@/app/actions/document-categories';
import { Button } from '@/components/ui/button';
import UploadSection from './upload-section';
import DocumentListClient from './DocumentListClient';
import { UploadProgressProvider } from './upload-progress-context';

export const metadata = {
  title: 'Documents | Theraptly LMS',
  description: 'Documents and attachments that have been uploaded are displayed here.',
};

// F-028: cap the per-user document read so this page can never load an unbounded
// number of rows (each row also fans out into versions → phiReport/courseVersions).
// The client list searches and paginates within this most-recent window; the cap
// is generous enough not to truncate realistic usage while bounding worst-case cost.
const DOCUMENTS_LIMIT = 200;

export default async function DocumentsPage() {
  // Registry gate: only roles granted `document.read` may open the org-wide
  // Document Hub (e.g. Finance and every worker role have no document access).
  // Mirrors the server actions in `src/app/actions/documents.ts`; the tenancy
  // boundary is the uploader's organizationId.
  //
  // Q26: this used to render an in-page access-denied card, which names the
  // module it is refusing. The founder ruling is that an unauthorised module is
  // hidden from the nav AND answers a typed URL with "Page not found".
  const { roleKey, organizationId } = await requirePermission('document.read', {
    onDeny: 'notFound',
  });

  // Distinct from the denial above: the role HOLDS document.read, it just has no
  // active membership yet. Falling through would query `organizationId: null`,
  // which reads as "every document that belongs to no organisation".
  if (!organizationId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">No organization found</h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Complete onboarding to set up your organization before managing documents.
        </p>
        <Button asChild className="mt-6">
          <Link href="/onboarding">Complete onboarding</Link>
        </Button>
      </div>
    );
  }

  const canCreate = can(roleKey, 'document.create');
  const canDelete = can(roleKey, 'document.delete');

  const categories = await getDocumentCategories();

  const docs = await prisma.document.findMany({
    // Q25: the Document Hub lists the ORGANIZATION's documents, read off the
    // document's own column. Archived ones are excluded by the client extension
    // (db/index.ts), not by a predicate here.
    where: { organizationId },
    include: {
      versions: {
        include: {
          phiReport: true,
          courseVersions: {
            include: { course: { select: { id: true, title: true, status: true } } },
          },
        },
        orderBy: { version: 'desc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: DOCUMENTS_LIMIT,
  });

  return (
    <UploadProgressProvider>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col">
        <header className="mb-[30px] flex flex-col gap-[5px]">
          <div className="flex items-center gap-4">
            <h1 className="min-w-0 flex-1 text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
              Documents
            </h1>
            {canCreate && <UploadSection categories={categories} />}
          </div>
          <p className="text-sm leading-tight font-medium text-[#a0aec0]">
            Documents and attachments that have been uploaded are displayed here
          </p>
        </header>

        <DocumentListClient
          initialDocs={docs}
          canUpload={canCreate}
          canDelete={canDelete}
          categories={categories}
        />
      </div>
    </UploadProgressProvider>
  );
}
