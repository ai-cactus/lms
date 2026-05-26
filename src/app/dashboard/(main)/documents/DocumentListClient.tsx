'use client';

import { useState, useTransition, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { deleteDocument, renameDocument } from '@/app/actions/documents';
import EmptyTableState from '@/components/ui/EmptyTableState';
import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CourseVersionEntry {
  courseId: string;
  course: {
    title: string;
    status: string; // 'draft' | 'published'
  };
}

interface DocumentVersionEntry {
  version: number;
  courseVersions: CourseVersionEntry[];
}

interface DocumentRow {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  updatedAt: Date | string;
  versions: DocumentVersionEntry[];
}

interface DocumentListClientProps {
  initialDocs: DocumentRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deriveStatus(
  courseVersions: CourseVersionEntry[],
): 'completed' | 'in-progress' | 'not-started' {
  if (courseVersions.length === 0) return 'not-started';
  // If any linked course is published, consider it completed
  if (courseVersions.some((cv) => cv.course.status === 'published')) return 'completed';
  return 'in-progress';
}

function getFileIcon(mimeType: string, filename: string) {
  const isPdf = mimeType === 'application/pdf' || filename.endsWith('.pdf');
  const isDoc =
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    filename.endsWith('.docx') ||
    filename.endsWith('.doc');

  const color = isPdf ? '#EF4444' : isDoc ? '#3B82F6' : '#94A3B8';

  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 2V8H20"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusBadge({ status }: { status: 'completed' | 'in-progress' | 'not-started' }) {
  if (status === 'completed') {
    return (
      <span className={`${styles.badge} ${styles.badgeCompleted}`}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="#166534" strokeWidth="2.5" />
          <path
            d="M8 12l3 3 5-5"
            stroke="#166534"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Completed
      </span>
    );
  }
  if (status === 'in-progress') {
    return (
      <span className={`${styles.badge} ${styles.badgeInProgress}`}>
        <span className={styles.badgeDot} aria-hidden="true" />
        In Progress
      </span>
    );
  }
  return <span className={`${styles.badge} ${styles.badgeNotStarted}`}>Not Started</span>;
}

// ---------------------------------------------------------------------------
// Rename modal (inline lightweight implementation)
// ---------------------------------------------------------------------------
function RenameModal({
  docId,
  currentName,
  onClose,
  onRenamed,
}: {
  docId: string;
  currentName: string;
  onClose: () => void;
  onRenamed: (newName: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Filename cannot be empty.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameDocument(docId, trimmed);
      if (result.success) {
        onRenamed(trimmed);
        onClose();
      } else {
        setError(result.error ?? 'Failed to rename document.');
      }
    });
  };

  return (
    <div
      className={styles.renameOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Rename document"
    >
      <div className={styles.renameDialog}>
        <h2 className={styles.renameTitle}>Rename Document</h2>
        <form onSubmit={handleSubmit}>
          <input
            className={styles.renameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={isPending}
            aria-label="New document name"
          />
          {error && <p className={styles.renameError}>{error}</p>}
          <div className={styles.renameActions}>
            <button
              type="button"
              className={styles.renameCancelBtn}
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </button>
            <button type="submit" className={styles.renameSaveBtn} disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DocumentListClient({ initialDocs }: DocumentListClientProps) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Three-dot dropdown
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Rename modal
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Sync with server props after revalidatePath
  useEffect(() => {
    setDocs(initialDocs);
  }, [initialDocs]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = () => setActiveDropdown(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.filename.toLowerCase().includes(q));
  }, [docs, searchQuery]);

  const totalPages = Math.ceil(filteredDocs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const pagedDocs = filteredDocs.slice(startIndex, startIndex + itemsPerPage);
  const totalEntries = filteredDocs.length;

  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) setCurrentPage(page);
    },
    [totalPages],
  );

  const handleRowClick = (docId: string) => {
    router.push(`/dashboard/documents/${docId}`);
  };

  const handleDelete = (e: React.MouseEvent, docId: string, filename: string) => {
    e.stopPropagation();
    setActiveDropdown(null);
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
        setDocs((prev) => prev.filter((d) => d.id !== docId));
      } else {
        setDeleteError(result.error ?? 'Failed to delete document.');
      }
      setDeletingId(null);
    });
  };

  const handleRenameClick = (e: React.MouseEvent, doc: DocumentRow) => {
    e.stopPropagation();
    setActiveDropdown(null);
    setRenameTarget({ id: doc.id, name: doc.filename });
  };

  const handleRenamed = (docId: string, newName: string) => {
    setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, filename: newName } : d)));
  };

  // Pagination page numbers to render (show max 5 page numbers with ellipsis)
  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (currentPage <= 3) return [1, 2, 3, '…', totalPages];
    if (currentPage >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
    return [1, '…', currentPage, '…', totalPages];
  }, [totalPages, currentPage]);

  return (
    <>
      {/* Rename modal */}
      {renameTarget && (
        <RenameModal
          docId={renameTarget.id}
          currentName={renameTarget.name}
          onClose={() => setRenameTarget(null)}
          onRenamed={(newName) => handleRenamed(renameTarget.id, newName)}
        />
      )}

      {deleteError && (
        <p className={styles.globalError} role="alert">
          ⚠️ {deleteError}
        </p>
      )}

      {/* Card */}
      <div className={styles.card}>
        {/* Search */}
        <div className={styles.searchWrapper}>
          <svg
            className={styles.searchIcon}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search for document..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Search documents"
          />
        </div>

        {/* Table */}
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thName}>Document Name</th>
                <th className={styles.thDate}>Date Uploaded</th>
                <th className={styles.thStatus}>Status</th>
                <th className={styles.thAction}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedDocs.length > 0 ? (
                pagedDocs.map((doc) => {
                  const latest = doc.versions[0];
                  const courseVersions = latest?.courseVersions || [];
                  const status = deriveStatus(courseVersions);
                  const hasCourse = courseVersions.length > 0;

                  const isDeleting = deletingId === doc.id;

                  return (
                    <tr key={doc.id} onClick={() => handleRowClick(doc.id)} className={styles.row}>
                      {/* Document name */}
                      <td className={styles.tdName}>
                        <div className={styles.docNameCell}>
                          <div className={styles.fileIcon}>
                            {getFileIcon(doc.mimeType, doc.filename)}
                          </div>
                          <div>
                            <div className={styles.filename}>{doc.filename}</div>
                            <div className={styles.fileMeta}>
                              {(doc.size / 1024 / 1024).toFixed(1)} MB
                              {latest?.version && ` • v${latest.version}`}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td className={styles.tdDate}>
                        {new Date(doc.updatedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Status */}
                      <td className={styles.tdStatus}>
                        <StatusBadge status={status} />
                      </td>

                      {/* Action */}
                      <td className={styles.tdAction} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.actionCell}>
                          {/* Three-dot menu */}
                          <div className={styles.dropdownWrap}>
                            <button
                              className={styles.dotsBtn}
                              title="More actions"
                              aria-label="More actions"
                              aria-expanded={activeDropdown === doc.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDropdown(activeDropdown === doc.id ? null : doc.id);
                              }}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <circle cx="12" cy="5" r="1.5" />
                                <circle cx="12" cy="12" r="1.5" />
                                <circle cx="12" cy="19" r="1.5" />
                              </svg>
                            </button>

                            {activeDropdown === doc.id && (
                              <div className={styles.dropdown} role="menu">
                                <button
                                  className={styles.dropdownItem}
                                  role="menuitem"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRowClick(doc.id);
                                  }}
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ marginRight: 8 }}
                                  >
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  View
                                </button>
                                <button
                                  className={styles.dropdownItem}
                                  role="menuitem"
                                  onClick={(e) => handleRenameClick(e, doc)}
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                    style={{ marginRight: 8 }}
                                  >
                                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                  </svg>
                                  Edit
                                </button>
                                <button
                                  className={`${styles.dropdownItem} ${styles.dropdownItemDanger} ${hasCourse || isDeleting ? styles.dropdownItemDisabled : ''}`}
                                  role="menuitem"
                                  disabled={hasCourse || isDeleting}
                                  title={
                                    hasCourse
                                      ? 'Cannot delete — this document has a linked course'
                                      : isDeleting
                                        ? 'Deleting…'
                                        : 'Delete document'
                                  }
                                  onClick={(e) => handleDelete(e, doc.id, doc.filename)}
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                  {isDeleting ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <EmptyTableState
                  message={searchQuery ? 'No documents match your search.' : 'No documents found.'}
                  subMessage={
                    searchQuery
                      ? 'Try a different search term.'
                      : 'Upload a document to get started.'
                  }
                  colSpan={4}
                  asTableRow
                />
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalEntries > 0 && (
          <div className={styles.pagination}>
            <span className={styles.paginationInfo}>
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalEntries)} of{' '}
              {totalEntries} entries
            </span>

            <div className={styles.paginationPages}>
              <button
                className={styles.pageBtn}
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              {pageNumbers.map((n, i) =>
                n === '…' ? (
                  <span key={`ellipsis-${i}`} className={styles.pageDots}>
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    className={`${styles.pageBtn} ${n === currentPage ? styles.pageBtnActive : ''}`}
                    onClick={() => handlePageChange(n as number)}
                    aria-current={n === currentPage ? 'page' : undefined}
                  >
                    {n}
                  </button>
                ),
              )}

              <button
                className={styles.pageBtn}
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || totalPages === 0}
                aria-label="Next page"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            <div className={styles.paginationShow}>
              Show
              <select
                className={styles.paginationSelect}
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                aria-label="Entries per page"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              entries
            </div>
          </div>
        )}
      </div>
    </>
  );
}
