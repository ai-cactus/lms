'use client';

import { useRouter } from 'next/navigation';
import styles from './page.module.css';

interface DocumentListClientProps {
    initialDocs: any[]; // Using any to avoid complex Prisma type imports on client, but ideally should be typed
}

export default function DocumentListClient({ initialDocs }: DocumentListClientProps) {
    const router = useRouter();

    const handleRowClick = (docId: string) => {
        router.push(`/dashboard/documents/${docId}`);
    };

    const handleViewCourse = (e: React.MouseEvent, courseId: string) => {
        e.stopPropagation(); // Prevent row click
        router.push(`/dashboard/courses/${courseId}`);
    };

    const getFileIcon = (mimeType: string, filename: string) => {
        if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
            return (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 2V8H20" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 18V12" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 15H15" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            );
        }
        if (
            mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mimeType === 'application/msword' ||
            filename.endsWith('.docx') ||
            filename.endsWith('.doc')
        ) {
            return (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 2V8H20" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M10 12H8V18H10C11.1 18 12 17.1 12 16V14C12 12.9 11.1 12 10 12Z" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            );
        }
        // Default Icon
        return (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 2V8H20" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    };

    return (
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>Document Name</th>
                    <th>Uploaded</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                {initialDocs.map(doc => {
                    const latest = doc.versions[0];
                    const courseLinks = latest?.courseVersions || [];
                    const hasCourse = courseLinks.length > 0;

                    return (
                        <tr key={doc.id} onClick={() => handleRowClick(doc.id)} className={styles.clickableRow}>
                            <td>
                                <div className={styles.docName}>
                                    <div className={styles.icon}>{getFileIcon(doc.mimeType, doc.filename)}</div>
                                    <div>
                                        <div className={styles.filename}>{doc.filename}</div>
                                        <div className={styles.meta}>{(doc.size / 1024 / 1024).toFixed(2)} MB • v{latest.version}</div>
                                    </div>
                                </div>
                            </td>
                            <td>{new Date(doc.updatedAt).toLocaleDateString()}</td>
                            <td>
                                {hasCourse ? (
                                    <span className={styles.badgeSuccess}>Completed</span>
                                ) : (
                                    <span style={{ backgroundColor: '#F3F4F6', color: '#374151', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>Not Started</span>
                                )}
                            </td>
                            <td>
                                <div className={styles.actions}>
                                    {hasCourse ? (
                                        <button
                                            onClick={(e) => handleViewCourse(e, courseLinks[0].courseId)}
                                            className={styles.actionBtn}
                                        >
                                            View Course
                                        </button>
                                    ) : (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(`/dashboard/courses/new?documentId=${doc.id}`);
                                            }}
                                            style={{
                                                backgroundColor: '#2563EB',
                                                color: 'white',
                                                border: 'none',
                                                padding: '6px 12px',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '12px'
                                            }}
                                        >
                                            Create Course
                                        </button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
