import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import UploadSection from './upload-section';
import DocumentListClient from './DocumentListClient';
import styles from './page.module.css';

export default async function DocumentsPage() {
  const session = await auth();
  const docs = await prisma.document.findMany({
    where: { userId: session?.user?.id },
    include: {
      versions: {
        include: {
          phiReport: true,
          courseVersions: { include: { course: true } },
        },
        orderBy: { version: 'desc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Documents</h1>
        <UploadSection />
      </header>

      <DocumentListClient initialDocs={docs} />
    </div>
  );
}
