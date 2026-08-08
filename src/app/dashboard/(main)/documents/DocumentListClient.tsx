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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RowActionsMenu, type RowAction } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Search,
  Eye,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileText,
  ShieldAlert,
} from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import {
  deriveDocumentStatus,
  DOCUMENT_STATUS_LABELS,
  type DocumentLifecycleStatus,
} from '@/lib/documents/status';

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
  phiReport?: { hasPHI: boolean } | null;
}

interface DocumentUploader {
  email: string;
  profile: { firstName: string | null; lastName: string | null } | null;
}

interface DocumentRow {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Null for documents uploaded before categories existed. */
  category?: string | null;
  updatedAt: Date | string;
  user?: DocumentUploader | null;
  versions: DocumentVersionEntry[];
}

interface DocumentListClientProps {
  initialDocs: DocumentRow[];
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getFileIcon(mimeType: string, filename: string) {
  const isPdf = mimeType === 'application/pdf' || filename.endsWith('.pdf');
  const isDoc =
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    filename.endsWith('.docx') ||
    filename.endsWith('.doc');

  // Solid file glyph: `fill` paints the sheet, `text-white` the rules inside it.
  return (
    <FileText
      aria-hidden="true"
      className={cn(
        'size-[29px] shrink-0 text-white',
        isPdf ? 'fill-[#f04438]' : isDoc ? 'fill-[#444ce7]' : 'fill-[#94a3b8]',
      )}
    />
  );
}

const tableHeadClass =
  'h-[41px] truncate text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] sm:text-[15.5px]';

function StatusBadge({ status }: { status: DocumentLifecycleStatus }) {
  if (status === 'converted') {
    return (
      <span className="inline-flex h-[33px] items-center gap-[5.5px] rounded-full bg-[#eafdf5] px-2 text-[12px] sm:text-[13px] font-semibold whitespace-nowrap text-[#308242]">
        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 fill-[#13a000] text-white" />
        {DOCUMENT_STATUS_LABELS.converted}
      </span>
    );
  }
  return (
    <span className="inline-flex h-[33px] items-center gap-1.5 rounded-full bg-[#fffad1] px-[10px] text-[13px] sm:px-[13px] sm:text-[14px] font-semibold whitespace-nowrap text-[#d8651e]">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {DOCUMENT_STATUS_LABELS.uploaded}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Rename modal
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Document</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Input
              className="h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={isPending}
              aria-label="New document name"
            />
            {error && <Alert variant="error">{error}</Alert>}
          </div>

          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DocumentListClient({
  initialDocs,
  canUpload,
  canEdit,
  canDelete,
}: DocumentListClientProps) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

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

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const docId = deleteTarget.id;
    setDeleteTarget(null);
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
      {renameTarget && (
        <RenameModal
          docId={renameTarget.id}
          currentName={renameTarget.name}
          onClose={() => setRenameTarget(null)}
          onRenamed={(newName) => handleRenamed(renameTarget.id, newName)}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &ldquo;{deleteTarget?.name}&rdquo; and all its versions
              from storage. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {deleteError && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          ⚠️ {deleteError}
        </p>
      )}

      <div className="rounded-xl border border-[#dfe1e6] bg-white p-[14px] sm:p-[21px]">
        <div className="mb-6 w-full sm:w-[470px]">
          <Input
            className="h-[38px] rounded-[8px] border-[#dfe1e6] pl-9 text-[15px] placeholder:text-[#a4abb8]"
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

        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead className={cn(tableHeadClass, 'rounded-l-[9px] px-1 sm:px-[18px]')}>
                Document Name
              </TableHead>
              <TableHead
                className={cn(
                  tableHeadClass,
                  'hidden px-5 sm:table-cell sm:w-[160px] lg:w-[200px]',
                )}
              >
                Date Uploaded
              </TableHead>
              <TableHead
                className={cn(tableHeadClass, 'w-[104px] px-1 sm:w-[170px] sm:px-5 lg:w-[190px]')}
              >
                Status
              </TableHead>
              <TableHead
                className={cn(
                  tableHeadClass,
                  'w-[44px] rounded-r-[9px] px-0 text-right sm:w-[80px] sm:px-2 lg:w-[254px] lg:px-[18px]',
                )}
              >
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedDocs.length > 0 ? (
              pagedDocs.map((doc) => {
                const latest = doc.versions[0];
                const courseVersions = latest?.courseVersions || [];
                const hasCourse = courseVersions.length > 0;
                const status = deriveDocumentStatus(hasCourse);
                const hasPHI = latest?.phiReport?.hasPHI ?? false;
                const isDeleting = deletingId === doc.id;

                const rowActions: RowAction[] = [
                  {
                    label: 'View',
                    icon: <Eye className="size-4" />,
                    onSelect: () => handleRowClick(doc.id),
                  },
                ];
                if (canEdit) {
                  rowActions.push({
                    label: 'Rename',
                    icon: <Pencil className="size-4" />,
                    onSelect: () => handleRenameClick(doc),
                  });
                }
                if (canDelete) {
                  rowActions.push({
                    label: isDeleting ? 'Deleting…' : 'Delete',
                    icon: <Trash2 className="size-4" />,
                    variant: 'destructive',
                    separatorBefore: true,
                    disabled: hasCourse || isDeleting,
                    onSelect: () => setDeleteTarget({ id: doc.id, name: doc.filename }),
                  });
                }

                return (
                  <TableRow
                    key={doc.id}
                    onClick={() => handleRowClick(doc.id)}
                    className="h-[71px] cursor-pointer"
                  >
                    <TableCell className="px-1 py-0 sm:px-[18px]">
                      <div className="flex items-center gap-3 sm:gap-[18px]">
                        {getFileIcon(doc.mimeType, doc.filename)}
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[14px] font-semibold tracking-[0.31px] text-[#0d0d12] sm:text-[15.5px]">
                              {doc.filename}
                            </span>
                            {doc.category && (
                              <span className="shrink-0 rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#475367]">
                                {doc.category}
                              </span>
                            )}
                          </span>
                          <span className="truncate text-[12px] font-normal tracking-[0.27px] text-[#666d80] sm:text-[13.5px]">
                            {formatFileSize(doc.size)}
                            {latest?.version && ` • v${latest.version}`}
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden truncate px-5 py-0 text-[15px] font-medium whitespace-nowrap text-[#0d0d12] sm:table-cell lg:text-[17px]">
                      {new Date(doc.updatedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </TableCell>

                    <TableCell className="px-1 py-0 sm:px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={status} />
                        {hasPHI && (
                          <span
                            className="inline-flex h-[33px] items-center gap-1.5 rounded-full bg-[#fbe7e7] px-[13px] text-[14px] font-semibold whitespace-nowrap text-[#e13737]"
                            title="This document was flagged as containing PHI"
                          >
                            <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
                            PHI Flagged
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell
                      className="px-0 py-0 text-right sm:px-2 lg:px-[18px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowActionsMenu
                        className="size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4"
                        actions={rowActions}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <EmptyTableState
                message={searchQuery ? 'No documents match your search.' : 'No documents found.'}
                subMessage={
                  searchQuery
                    ? 'Try a different search term.'
                    : canUpload
                      ? 'Upload a document to get started.'
                      : 'No documents have been uploaded yet.'
                }
                colSpan={4}
                asTableRow
              />
            )}
          </TableBody>
        </Table>

        {totalEntries > 0 && (
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
            <span className="text-xs font-medium tracking-[-0.36px] text-[#9a9a9a]">
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalEntries)} of{' '}
              {totalEntries} entries
            </span>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>

              {pageNumbers.map((n, i) =>
                n === '…' ? (
                  <span
                    key={`ellipsis-${i}`}
                    className="flex size-10 items-center justify-center text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={n}
                    variant={n === currentPage ? 'default' : 'ghost'}
                    size="icon-sm"
                    className="size-10 rounded-[8px] text-xs font-medium tracking-[-0.36px] data-[variant=ghost]:text-[#1c1c1c]"
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
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || totalPages === 0}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex items-center gap-3 text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]">
              Show
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(v) => {
                  setItemsPerPage(Number(v));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[66px] rounded-[8px] border-[#d9d9d9] px-3 text-xs">
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
