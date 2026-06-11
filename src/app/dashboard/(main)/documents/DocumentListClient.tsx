'use client';

import { useState, useTransition, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { deleteDocument, renameDocument } from '@/app/actions/documents';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RowActionsMenu } from '@/components/ui';
import {
  Search,
  Eye,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileText,
  FileX2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

  return (
    <FileText
      aria-hidden="true"
      className={cn(
        'size-[22px]',
        isPdf ? 'text-[#EF4444]' : isDoc ? 'text-[#3B82F6]' : 'text-[#94A3B8]',
      )}
    />
  );
}

function StatusBadge({ status }: { status: 'completed' | 'in-progress' | 'not-started' }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
        <CheckCircle2 className="size-3.5" />
        Completed
      </span>
    );
  }
  if (status === 'in-progress') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
        <span className="size-1.5 rounded-full bg-warning" />
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      Not Started
    </span>
  );
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
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Rename document"
    >
      <div className="w-full max-w-[420px] rounded-xl bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
        <h2 className="mb-4 text-lg font-semibold text-[#111827]">Rename Document</h2>
        <form onSubmit={handleSubmit}>
          <input
            className="w-full rounded-lg border border-[#d1d5db] px-3.5 py-2.5 text-sm text-[#111827] outline-none transition-[border-color] focus:border-[#4731f7] focus:ring-[3px] focus:ring-[rgba(71,49,247,0.1)] disabled:opacity-60 box-border"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={isPending}
            aria-label="New document name"
          />
          {error && <p className="mt-1.5 text-[0.8125rem] text-[#dc2626]">{error}</p>}
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              className="rounded-lg border border-[#d1d5db] bg-white px-4 py-2 text-sm text-[#374151] transition-colors hover:bg-[#f9fafb] disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg border-0 bg-[#4731f7] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b27d4] disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isPending}
            >
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

  const handleDelete = (docId: string, filename: string) => {
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

  const handleRenameClick = (doc: DocumentRow) => {
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
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          ⚠️ {deleteError}
        </p>
      )}

      {/* Card */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
        {/* Search */}
        <div className="mb-6 w-full sm:w-[380px]">
          <Input
            className="h-11"
            type="search"
            placeholder="Search for document..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Search documents"
            startIcon={<Search aria-hidden="true" />}
          />
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead>Document Name</TableHead>
              <TableHead className="hidden sm:table-cell">Date Uploaded</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedDocs.length > 0 ? (
              pagedDocs.map((doc) => {
                const latest = doc.versions[0];
                const courseVersions = latest?.courseVersions || [];
                const status = deriveStatus(courseVersions);
                const hasCourse = courseVersions.length > 0;
                const isDeleting = deletingId === doc.id;

                return (
                  <TableRow
                    key={doc.id}
                    onClick={() => handleRowClick(doc.id)}
                    className="cursor-pointer"
                  >
                    {/* Document name */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f1f5f9]">
                          {getFileIcon(doc.mimeType, doc.filename)}
                        </div>
                        <div>
                          <div className="font-semibold text-[#1a202c]">{doc.filename}</div>
                          <div className="text-xs text-[#718096]">
                            {(doc.size / 1024 / 1024).toFixed(1)} MB
                            {latest?.version && ` • v${latest.version}`}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Date */}
                    <TableCell className="text-[#6b7280] whitespace-nowrap hidden sm:table-cell">
                      {new Date(doc.updatedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </TableCell>

                    {/* Status */}
                    <TableCell className="hidden md:table-cell">
                      <StatusBadge status={status} />
                    </TableCell>

                    {/* Action – RowActionsMenu */}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'View',
                            icon: <Eye className="size-4" />,
                            onSelect: () => handleRowClick(doc.id),
                          },
                          {
                            label: 'Edit Name',
                            icon: <Pencil className="size-4" />,
                            onSelect: () => handleRenameClick(doc),
                          },
                          {
                            label: isDeleting ? 'Deleting…' : 'Delete',
                            icon: <Trash2 className="size-4" />,
                            variant: 'destructive',
                            separatorBefore: true,
                            disabled: hasCourse || isDeleting,
                            onSelect: () => handleDelete(doc.id, doc.filename),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-center p-[60px] text-slate-500">
                  <div className="flex flex-col items-center gap-3">
                    <FileX2 className="size-16 text-slate-300" />
                    <p className="text-base font-semibold text-[#2D3748]">
                      {searchQuery ? 'No documents match your search.' : 'No documents found.'}
                    </p>
                    <p className="text-sm text-slate-500">
                      {searchQuery
                        ? 'Try a different search term.'
                        : 'Upload a document to get started.'}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalEntries > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[#edf2f7] pt-4">
            <span className="text-sm text-[#718096]">
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalEntries)} of{' '}
              {totalEntries} entries
            </span>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>

              {pageNumbers.map((n, i) =>
                n === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-[#718096]">
                    …
                  </span>
                ) : (
                  <Button
                    key={n}
                    variant={n === currentPage ? 'default' : 'outline'}
                    size="icon-sm"
                    onClick={() => handlePageChange(n as number)}
                    aria-current={n === currentPage ? 'page' : undefined}
                  >
                    {n}
                  </Button>
                ),
              )}

              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || totalPages === 0}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-[#718096]">
              Show
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(v) => {
                  setItemsPerPage(Number(v));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger size="sm" className="w-[72px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
              entries
            </div>
          </div>
        )}
      </div>
    </>
  );
}
