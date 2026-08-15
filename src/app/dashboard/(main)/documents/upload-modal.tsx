'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText, X, XCircle } from 'lucide-react';
import { uploadDocuments, type DocumentUploadResult } from '@/app/actions/documents';
import { createDocumentCategory } from '@/app/actions/document-categories';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import FileUpload from '@/components/ui/FileUpload';
import {
  MAX_DOCUMENT_CATEGORY_LENGTH,
  OTHER_CATEGORY_OPTION,
} from '@/lib/documents/document-categories';
import { formatFileSize } from '@/lib/utils';
import { useUploadProgress } from './upload-progress-context';

// Client-side guard only — `uploadDocuments` re-validates size and type, and its
// cap is env-configurable server-side. This mirrors the limit stated in the UI.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = /\.(pdf|docx)$/i;
const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function isAcceptedType(file: File): boolean {
  return ACCEPTED_MIME_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.test(file.name);
}

interface UploadModalProps {
  onClose: () => void;
  /** The organization's category vocabulary, as rendered by the server page. */
  categories: string[];
}

export default function UploadModal({ onClose, categories }: UploadModalProps) {
  const router = useRouter();
  const { startUploads, clearUploads } = useUploadProgress();

  const [step, setStep] = useState<'category' | 'files'>('category');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [isNamingCategory, setIsNamingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingCategory, startCategoryTransition] = useTransition();

  const [files, setFiles] = useState<File[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<DocumentUploadResult[]>([]);
  const [isUploading, startUploadTransition] = useTransition();

  // "Other" doubles as a seeded category name, so it is rendered once — as the
  // add-new affordance pinned to the bottom — rather than as its own bucket.
  const selectableCategories = useMemo(
    () => categories.filter((option) => option !== OTHER_CATEGORY_OPTION),
    [categories],
  );

  const handleCategoryChange = (value: string) => {
    setCategoryError(null);
    if (value === OTHER_CATEGORY_OPTION) {
      setIsNamingCategory(true);
      setCategory('');
      return;
    }
    setCategory(value);
  };

  const handleContinue = () => {
    if (!isNamingCategory) {
      if (!category) {
        setCategoryError('Select a category to continue.');
        return;
      }
      setStep('files');
      return;
    }

    const trimmed = customCategory.trim();
    if (!trimmed) {
      setCategoryError('Category name is required.');
      return;
    }
    if (trimmed.length > MAX_DOCUMENT_CATEGORY_LENGTH) {
      setCategoryError(
        `Category name is too long (max ${MAX_DOCUMENT_CATEGORY_LENGTH} characters).`,
      );
      return;
    }

    setCategoryError(null);
    startCategoryTransition(async () => {
      const outcome = await createDocumentCategory(trimmed);
      if (outcome.error || !outcome.name) {
        setCategoryError(outcome.error ?? 'Could not add that category. Please try again.');
        return;
      }
      setCategory(outcome.name);
      // The hub filter reads the org's categories server-side, so the new one
      // has to reach it before the list re-renders.
      router.refresh();
      setStep('files');
    });
  };

  const handleFilesSelected = (selected: File[]) => {
    setValidationError(null);
    setFormError(null);

    const rejected: string[] = [];
    const accepted = selected.filter((file) => {
      if (!isAcceptedType(file)) {
        rejected.push(`${file.name} (only PDF and DOCX are allowed)`);
        return false;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} (exceeds 10MB)`);
        return false;
      }
      return true;
    });

    if (rejected.length > 0) {
      setValidationError(`Skipped ${rejected.length} file(s): ${rejected.join(', ')}`);
    }

    setFiles((prev) => {
      // Re-picking the same file (name + size) must not queue it twice.
      const seen = new Set(prev.map((file) => `${file.name}:${file.size}`));
      return [...prev, ...accepted.filter((file) => !seen.has(`${file.name}:${file.size}`))];
    });
  };

  const removeFile = (name: string, size: number) => {
    setFiles((prev) => prev.filter((file) => !(file.name === name && file.size === size)));
  };

  const handleSubmit = () => {
    if (files.length === 0) return;

    setFormError(null);
    setResults([]);

    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    formData.append('phiAttested', agreed ? 'true' : 'false');
    formData.append('category', category);

    // The list shows these as "In progress" rows for as long as the action runs.
    startUploads(files, category);

    startUploadTransition(async () => {
      let outcome: Awaited<ReturnType<typeof uploadDocuments>>;
      try {
        outcome = await uploadDocuments(formData);
      } catch {
        setFormError('Upload failed. Please check your connection and try again.');
        return;
      } finally {
        // Never strand an "In progress" row, however the action ended.
        clearUploads();
      }

      if (outcome.error) {
        setFormError(outcome.error);
        return;
      }

      setResults(outcome.results);

      // Successful files leave the queue; failures stay listed so the user can
      // fix the cause and retry only those.
      const failedNames = new Set(
        outcome.results.filter((result) => !result.ok).map((result) => result.name),
      );
      setFiles((prev) => prev.filter((file) => failedNames.has(file.name)));

      if (failedNames.size === 0) {
        router.refresh();
        onClose();
      }
    });
  };

  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const isRetry = failed.length > 0 && files.length > 0;
  const fileCount = files.length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>Supports PDF and Word documents up to 10MB each.</DialogDescription>
        </DialogHeader>

        {step === 'category' ? (
          <div className="flex flex-col gap-5">
            {isNamingCategory ? (
              <Field
                label="Category"
                required
                error={categoryError ?? undefined}
                helperText="The new categories will appear in the hub filter for every facility immediately."
              >
                <Input
                  value={customCategory}
                  onChange={(event) => {
                    setCustomCategory(event.target.value);
                    setCategoryError(null);
                  }}
                  maxLength={MAX_DOCUMENT_CATEGORY_LENGTH}
                  autoFocus
                  aria-label="Category"
                  placeholder="e.g. Clinical Operations"
                  disabled={isSavingCategory}
                />
              </Field>
            ) : (
              <Field label="Category" required error={categoryError ?? undefined}>
                <Select value={category} onValueChange={handleCategoryChange}>
                  <SelectTrigger className="h-11 w-full" aria-label="Category">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableCategories.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER_CATEGORY_OPTION}>{OTHER_CATEGORY_OPTION}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <FileUpload
              multiple
              hideIcon
              className="min-h-[135px] p-6"
              onFilesSelected={handleFilesSelected}
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              label={
                <>
                  Drop files here or <span className="text-primary">browse</span>
                </>
              }
              description="PDF or DOCX · up to 10 MB each"
            />

            {fileCount > 0 && (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
                {files.map((file) => (
                  <li
                    key={`${file.name}:${file.size}`}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <FileText className="size-5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {file.name}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {formatFileSize(file.size)}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${file.name}`}
                      disabled={isUploading}
                      onClick={() => removeFile(file.name, file.size)}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-start gap-2 text-sm text-text-secondary">
              <Checkbox
                id="phi-agree"
                checked={agreed}
                onCheckedChange={(c) => setAgreed(c === true)}
                className="mt-0.5"
              />
              <label htmlFor="phi-agree" className="cursor-pointer">
                I verify this document contains no Personal Health Information (PHI).
              </label>
            </div>

            {validationError && <Alert variant="error">{validationError}</Alert>}
            {formError && <Alert variant="error">{formError}</Alert>}

            {results.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="Upload results">
                {succeeded.map((result) => (
                  <li
                    key={`ok-${result.name}`}
                    className="flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm"
                  >
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {result.name}
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-success">Uploaded</span>
                  </li>
                ))}
                {failed.map((result) => (
                  <li
                    key={`failed-${result.name}`}
                    className="flex items-start gap-2.5 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-sm"
                  >
                    <XCircle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden="true" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-foreground">{result.name}</span>
                      <span className="text-xs text-error">
                        {result.error ?? 'Upload failed. Please try again.'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={onClose}
            disabled={isSavingCategory || isUploading}
          >
            Cancel
          </Button>
          {step === 'category' ? (
            <Button type="button" onClick={handleContinue} loading={isSavingCategory}>
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              loading={isUploading}
              disabled={fileCount === 0 || isUploading || !agreed}
            >
              {isUploading
                ? 'Scanning for PHI…'
                : `${isRetry ? 'Retry' : 'Upload'} ${fileCount} file${fileCount === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
