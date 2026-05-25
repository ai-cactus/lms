import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import UploadSection from './upload-section';
import DocumentListClient from './DocumentListClient';
import styles from './page.module.css';

export const metadata = {
  title: 'Documents | Theraptly LMS',
  description: 'Documents and attachments that have been uploaded are displayed here.',
};

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
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1>Documents</h1>
          <p className={styles.headerSubtitle}>
            Documents and attachments that have been uploaded are displayed here
          </p>
        </div>
        <UploadSection />
      </header>

      <DocumentListClient initialDocs={docs} />
    </div>
  );
}
