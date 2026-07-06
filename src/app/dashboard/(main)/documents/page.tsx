import { auth } from '@/auth';
import prisma from '@/lib/prisma';
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

  const docs = await prisma.document.findMany({
    where: { userId: session?.user?.id },
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
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <header className="mb-8 flex items-start justify-between gap-4 max-sm:flex-col">
        <div>
          <h1 className="text-2xl font-bold text-[#1a202c]">Documents</h1>
          <p className="mt-1 text-sm text-[#718096]">
            Documents and attachments that have been uploaded are displayed here
          </p>
        </div>
        <UploadSection />
      </header>

      <DocumentListClient initialDocs={docs} />
    </div>
  );
}
