'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteDocument } from '@/app/actions/documents';
import EmptyTableState from '@/components/ui/EmptyTableState';
import styles from './page.module.css';

interface DocumentListClientProps {
  initialDocs: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    updatedAt: Date | string;
    versions: {
      version: number;
      courseVersions: { courseId: string }[];
    }[];
  }[];
}

export default function DocumentListClient({ initialDocs }: DocumentListClientProps) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleRowClick = (docId: string) => {
    router.push(`/dashboard/documents/${docId}`);
  };

  const handleViewCourse = (e: React.MouseEvent, courseId: string) => {
    e.stopPropagation();
    router.push(`/dashboard/courses/${courseId}`);
  };

  const handleDelete = (e: React.MouseEvent, docId: string, filename: string) => {
    e.stopPropagation();
    if (
      !confirm(
        `Delete "${filename}"?\n\nThis will permanently remove the file from storage and cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingId(docId);
    setDeleteError(null);

    startTransition(async () => {
      const result = await deleteDocument(docId);
      if (result.success) {
        // Optimistic removal — no full page reload needed
        setDocs((prev) => prev.filter((d) => d.id !== docId));
      } else {
        setDeleteError(result.error ?? 'Failed to delete document.');
      }
      setDeletingId(null);
    });
  };

  const getFileIcon = (mimeType: string, filename: string) => {
    if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      return (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 2V8H20"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 18V12"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 15H15"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
            stroke="#3B82F6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 2V8H20"
            stroke="#3B82F6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 12H8V18H10C11.1 18 12 17.1 12 16V14C12 12.9 11.1 12 10 12Z"
            stroke="#3B82F6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
          stroke="#94A3B8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 2V8H20"
          stroke="#94A3B8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <>
      {deleteError && (
        <p style={{ color: '#EF4444', marginBottom: '12px', fontSize: '14px' }}>⚠️ {deleteError}</p>
      )}
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
          {docs.length > 0 ? (
            docs.map((doc) => {
              const latest = doc.versions[0];
              const courseLinks = latest?.courseVersions || [];
              const hasCourse = courseLinks.length > 0;
              const isDeleting = deletingId === doc.id;

              return (
                <tr
                  key={doc.id}
                  onClick={() => handleRowClick(doc.id)}
                  className={styles.clickableRow}
                >
                  <td>
                    <div className={styles.docName}>
                      <div className={styles.icon}>{getFileIcon(doc.mimeType, doc.filename)}</div>
                      <div>
                        <div className={styles.filename}>{doc.filename}</div>
                        <div className={styles.meta}>
                          {(doc.size / 1024 / 1024).toFixed(2)} MB • v{latest.version}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{new Date(doc.updatedAt).toLocaleDateString()}</td>
                  <td>
                    {hasCourse ? (
                      <span className={styles.badgeSuccess}>Completed</span>
                    ) : (
                      <span
                        style={{
                          backgroundColor: '#F3F4F6',
                          color: '#374151',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        Not Started
                      </span>
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
                            router.push(`/dashboard/courses/create?documentId=${doc.id}`);
                          }}
                          className={styles.actionBtn}
                        >
                          Create Course
                        </button>
                      )}

                      {/* Delete — disabled if document has an associated course */}
                      <button
                        onClick={(e) => handleDelete(e, doc.id, doc.filename)}
                        disabled={isDeleting || hasCourse}
                        title={
                          hasCourse
                            ? 'Cannot delete — this document has a linked course'
                            : 'Delete document'
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: isDeleting || hasCourse ? 'not-allowed' : 'pointer',
                          opacity: hasCourse ? 0.35 : isDeleting ? 0.6 : 1,
                          padding: '4px',
                          color: '#EF4444',
                          display: 'flex',
                          alignItems: 'center',
                          marginLeft: '4px',
                          flexShrink: 0,
                        }}
                      >
                        {isDeleting ? (
                          /* Spinner */
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            style={{ animation: 'spin 1s linear infinite' }}
                          >
                            <circle
                              cx="12"
                              cy="12"
                              r="10"
                              strokeDasharray="40"
                              strokeDashoffset="10"
                            />
                          </svg>
                        ) : (
                          /* Trash icon */
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <EmptyTableState
              message="No documents found."
              subMessage="Upload a document to get started."
              colSpan={4}
              asTableRow
            />
          )}
        </tbody>
      </table>
    </>
  );
}
