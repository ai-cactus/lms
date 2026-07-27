import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { Button } from '@/components/ui/button';
import UploadSection from './upload-section';
import DocumentListClient from './DocumentListClient';

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
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const { role, organizationId } = session.user;
  const roleKey = dbRoleToRoleKey(role);

  // Registry gate: only roles granted `document.read` may open the org-wide
  // Document Hub (e.g. Finance and every worker role have no document access).
  // Mirrors the server actions in `src/app/actions/documents.ts`; the tenancy
  // boundary is the uploader's organizationId.
  if (!organizationId || !can(roleKey, 'document.read')) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">
          You don&apos;t have access to Documents
        </h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          The Document Hub is limited to roles that manage compliance documents. Contact your
          organization&apos;s owner if you need access.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  const canCreate = can(roleKey, 'document.create');
  const canEdit = can(roleKey, 'document.edit');
  const canDelete = can(roleKey, 'document.delete');

  const docs = await prisma.document.findMany({
    where: { user: { organizationId } },
    include: {
      user: {
        select: { email: true, profile: { select: { firstName: true, lastName: true } } },
      },
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
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <header className="mb-[30px] flex flex-col gap-[5px]">
        <div className="flex items-center gap-4">
          <h1 className="min-w-0 flex-1 text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
            Documents
          </h1>
          {canCreate && <UploadSection />}
        </div>
        <p className="text-sm leading-tight font-medium text-[#a0aec0]">
          Documents and attachments that have been uploaded are displayed here
        </p>
      </header>

      <DocumentListClient
        initialDocs={docs}
        canUpload={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
