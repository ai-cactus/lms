import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { isAdminRole } from '@/lib/rbac/role-utils';
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

  // Org-scoped Document Hub: every org admin sees all documents uploaded in
  // their organization. isAdminRole is defense-in-depth; the tenancy boundary
  // is the uploader's organizationId.
  const organizationId = session?.user?.organizationId;
  const canView = !!session?.user?.id && !!organizationId && isAdminRole(session.user.role);

  const docs = canView
    ? await prisma.document.findMany({
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
      })
    : [];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <header className="mb-[30px] flex flex-col gap-[5px]">
        <div className="flex items-center gap-4">
          <h1 className="min-w-0 flex-1 text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
            Documents
          </h1>
          <UploadSection />
        </div>
        <p className="text-sm leading-tight font-medium text-[#a0aec0]">
          Documents and attachments that have been uploaded are displayed here
        </p>
      </header>

      <DocumentListClient initialDocs={docs} />
    </div>
  );
}
