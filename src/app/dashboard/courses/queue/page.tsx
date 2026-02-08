import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import styles from './queue.module.css';

export default async function QueuePage() {
    const session = await auth();
    const jobs = await prisma.job.findMany({
        where: { userId: session?.user?.id },
        orderBy: { createdAt: 'desc' }
    });

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1>Job Queue</h1>
            </header>

            <div className={styles.list}>
                {jobs.map(job => (
                    <div key={job.id} className={styles.jobCard}>
                        <div className={styles.jobInfo}>
                            <span className={styles.jobType}>{job.type.replace('_', ' ')}</span>
                            <span className={styles.jobMeta}>
                                Created: {job.createdAt.toLocaleTimeString()}
                            </span>
                        </div>
                        <span className={`${styles.status} ${styles['status_' + job.status]}`}>
                            {job.status}
                        </span>
                    </div>
                ))}
                {jobs.length === 0 && (
                    <p className="text-gray-500">No active jobs.</p>
                )}
            </div>
        </div>
    );
}
