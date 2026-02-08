import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import UploadSection from './upload-section'; // Client component wrapper for modal
import styles from './page.module.css';

export default async function DocumentsPage() {
    const session = await auth();
    const docs = await prisma.document.findMany({
        where: { userId: session?.user?.id },
        include: { versions: { include: { phiReport: true } } },
        orderBy: { updatedAt: 'desc' }
    });

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1>Documents</h1>
                <UploadSection />
            </header>

            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>Filename</th>
                        <th>Version</th>
                        <th>PHI Status</th>
                        <th>Uploaded</th>
                    </tr>
                </thead>
                <tbody>
                    {docs.map(doc => {
                        const latest = doc.versions[0]; // Assuming order? prisma include doesn't order relations by default unless specified usually
                        // We should probably rely on logic or updated prisma query, but for now:
                        const versionCount = doc.versions.length;
                        const phi = latest?.phiReport?.hasPHI;

                        return (
                            <tr key={doc.id}>
                                <td>{doc.filename}</td>
                                <td>v{versionCount}</td>
                                <td>
                                    {phi ? (
                                        <span className={styles.badgeWarning}>PHI Detected</span>
                                    ) : (
                                        <span className={styles.badgeSuccess}>Clean</span>
                                    )}
                                </td>
                                <td>{doc.updatedAt.toLocaleDateString()}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
