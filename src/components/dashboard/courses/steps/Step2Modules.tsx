'use client';

import React, { useEffect, useImperativeHandle, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import FileUpload from '@/components/ui/FileUpload';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getDocuments, uploadDocument } from '@/app/actions/documents';
import { formatFileSize } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { CourseWizardModule, CourseWizardModuleDocument } from '@/types/course';
import { isWholeCourse } from '@/lib/course/structure';
import {
  wizardCardInputClass,
  wizardCardLabelClass,
  wizardCardControlClass,
  wizardSubtitleClass,
  wizardTitleClass,
} from './wizardFormClasses';

const DEADLINE_OPTIONS = [1, 2, 3, 5, 7, 14, 30];

/**
 * Where the in-progress module form stands, so the wizard can gate Continue:
 * `partial` blocks it (half-filled work would be silently dropped), `complete`
 * is committed on Next via `commitDraft`.
 */
export type ModuleDraftStatus = 'empty' | 'partial' | 'complete';

export interface Step2ModulesHandle {
  /** Commits a complete in-progress module, returning it, or null when incomplete. */
  commitDraft: () => CourseWizardModule | null;
}

type ScanState = 'idle' | 'uploading' | 'clean' | 'phi';

interface Step2ModulesProps {
  modules: CourseWizardModule[];
  onModulesChange: (modules: CourseWizardModule[]) => void;
  onDraftStatusChange?: (status: ModuleDraftStatus) => void;
  /**
   * Document from the `?documentId=` deep link, seeding the first upload slot.
   * Read once, on mount — the wizard re-keys this step when it resolves.
   */
  initialDocument?: CourseWizardModuleDocument | null;
  ref?: React.Ref<Step2ModulesHandle>;
}

function isPdf(fileName: string | undefined, mimeType: string | undefined) {
  return mimeType === 'application/pdf' || Boolean(fileName?.toLowerCase().endsWith('.pdf'));
}

function FileTypeIcon({
  fileName,
  mimeType,
  className,
}: {
  fileName?: string;
  mimeType?: string;
  className?: string;
}) {
  return (
    <FileText
      className={`${className ?? 'size-7'} ${isPdf(fileName, mimeType) ? 'text-error' : 'text-primary'}`}
      aria-hidden="true"
    />
  );
}

export default function Step2Modules({
  modules,
  onModulesChange,
  onDraftStatusChange,
  initialDocument,
  ref,
}: Step2ModulesProps) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [deadlineDays, setDeadlineDays] = useState('');
  const [attachment, setAttachment] = useState<CourseWizardModuleDocument | null>(
    initialDocument ?? null,
  );
  const [phiAttested, setPhiAttested] = useState(false);
  const [scanState, setScanState] = useState<ScanState>(initialDocument ? 'clean' : 'idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // The first module may turn out to BE the whole course — nobody knows until the
  // admin does or does not add a second — and a whole course has no per-module
  // deadline, so the field only appears from the second module onward.
  const requiresDeadline = modules.length > 0;
  // Deleting a committed module can turn the one being authored back into the
  // first, so a deadline chosen while the field was showing must not leak into
  // what is now a whole course.
  const effectiveDeadlineDays = requiresDeadline ? deadlineDays : '';

  const isComplete = Boolean(
    title.trim() &&
    objective.trim() &&
    (!requiresDeadline || effectiveDeadlineDays) &&
    attachment &&
    scanState !== 'uploading',
  );
  const isEmpty = !title.trim() && !objective.trim() && !effectiveDeadlineDays && !attachment;
  const status: ModuleDraftStatus =
    scanState === 'uploading' ? 'partial' : isComplete ? 'complete' : isEmpty ? 'empty' : 'partial';

  useEffect(() => {
    onDraftStatusChange?.(status);
  }, [status, onDraftStatusChange]);

  const resetDraft = () => {
    setTitle('');
    setObjective('');
    setDeadlineDays('');
    setAttachment(null);
    setPhiAttested(false);
    setScanState('idle');
    setUploadError(null);
    setFormError(null);
  };

  const commitDraft = (): CourseWizardModule | null => {
    if (!isComplete || !attachment) return null;

    const committed: CourseWizardModule = {
      title: title.trim(),
      objective: objective.trim(),
      completionDeadlineDays: effectiveDeadlineDays ? Number(effectiveDeadlineDays) : null,
      documentId: attachment.documentId,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
    };

    onModulesChange([...modules, committed]);
    resetDraft();
    return committed;
  };

  useImperativeHandle(ref, () => ({ commitDraft }));

  const handleAddModule = () => {
    if (!isComplete) {
      setFormError(
        requiresDeadline
          ? 'Add a title, objective, deadline and training document to add this module.'
          : 'Add a title, objective and training document to add this module.',
      );
      return;
    }
    commitDraft();
  };

  const handleRemoveModule = (index: number) => {
    const remaining = modules.filter((_, i) => i !== index);
    // Dropping back to a whole course clears the survivor's deadline, so the
    // "one module ⇒ no per-module deadline" invariant also holds in the database
    // — the field is never offered for module 1, so it cannot be re-entered.
    onModulesChange(
      isWholeCourse(remaining.length)
        ? remaining.map((module) => ({ ...module, completionDeadlineDays: null }))
        : remaining,
    );
  };

  const handleFilesSelected = async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setUploadError(null);
    setFormError(null);

    if (!phiAttested) {
      setUploadError('Confirm the document contains no PHI before uploading.');
      return;
    }

    setScanState('uploading');

    const uploadFormData = new FormData();
    uploadFormData.append('file', file);
    uploadFormData.append('phiAttested', 'true');

    try {
      const result = await uploadDocument(null, uploadFormData);

      // Compliance: a flagged document is never stored server-side, so the slot
      // is cleared too — the module needs a clean document before it can be added.
      if (result.phiDetected) {
        logger.warn({ msg: '[course] Module document rejected — PHI detected' });
        setAttachment(null);
        setScanState('phi');
        return;
      }

      if (result.error) {
        setScanState('idle');
        setUploadError(result.error);
        return;
      }

      // `uploadDocument` reports success without the new id, so the stored
      // document is matched back by filename (newest first).
      const storedDocuments = await getDocuments();
      const stored = storedDocuments.find((doc) => doc.filename === file.name);
      if (!stored) {
        setScanState('idle');
        setUploadError('The uploaded document could not be found. Please try again.');
        return;
      }

      setAttachment({
        documentId: stored.id,
        fileName: stored.filename,
        fileSize: stored.size,
        mimeType: stored.mimeType,
      });
      setScanState('clean');
      logger.info({ msg: '[course] Module training document uploaded', documentId: stored.id });
    } catch (err) {
      logger.error({ msg: '[course] Module training document upload failed', err });
      setScanState('idle');
      setUploadError('Upload failed. Please try again.');
    }
  };

  const handleRemoveAttachment = () => {
    setAttachment(null);
    setScanState('idle');
    setUploadError(null);
  };

  return (
    <div className="flex w-full flex-col gap-8 md:gap-10">
      <div className="flex flex-col items-center gap-3">
        <h2 className={wizardTitleClass}>Create Course Modules</h2>
        <p className={wizardSubtitleClass}>
          Organize your course into modules to make learning structured, easy to follow, and
          audit-ready. Each module should include a title, learning objective, and supporting
          training document.
        </p>
      </div>

      {modules.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {modules.map((module, index) => (
            <li
              key={`${module.documentId}-${index}`}
              className="relative flex flex-col overflow-hidden rounded-[10px] border border-dashed border-[#c9d2f5] bg-white"
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete module ${index + 1}`}
                onClick={() => handleRemoveModule(index)}
                className="absolute right-1.5 top-1.5 size-8 text-error hover:bg-error/10 hover:text-error"
              >
                <Trash2 className="size-4" />
              </Button>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <FileTypeIcon fileName={module.fileName} mimeType={module.mimeType} />
                <p
                  className="truncate text-[13px] font-semibold text-[#0d0d12]"
                  title={module.title}
                >
                  {module.title}
                </p>
                <p className="line-clamp-4 text-xs leading-5 text-[#666d80]">{module.objective}</p>
              </div>
              <p className="bg-primary py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-primary-foreground">
                Module {index + 1}
              </p>
            </li>
          ))}
        </ul>
      )}

      <section className="w-full rounded-[14px] border border-[#e9ebf2] bg-[#f8f9fc] p-5 md:p-6">
        <h3 className="mb-5 text-[15px] font-semibold text-[#0d0d12]">Module Information</h3>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.3fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="module-title" className={wizardCardLabelClass}>
                Module Title <span className="text-error">*</span>
              </label>
              <input
                id="module-title"
                className={wizardCardInputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Infection Prevention & Control"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="module-objective" className={wizardCardLabelClass}>
                Objective <span className="text-error">*</span>
              </label>
              <textarea
                id="module-objective"
                className={`${wizardCardInputClass} h-auto min-h-[80px] resize-y py-2.5 leading-5`}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Describe what learners should understand"
              />
            </div>

            {requiresDeadline && (
              <div className="flex flex-col gap-1.5">
                <label className={wizardCardLabelClass} id="module-deadline-label">
                  Module Completion Deadline <span className="text-error">*</span>
                </label>
                <Select value={deadlineDays} onValueChange={setDeadlineDays}>
                  <SelectTrigger
                    className={wizardCardControlClass}
                    aria-labelledby="module-deadline-label"
                  >
                    <SelectValue placeholder="Choose an option" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEADLINE_OPTIONS.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {days === 1 ? '1 day' : `${days} days`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={wizardCardLabelClass}>
              Upload Training Document <span className="text-error">*</span>
            </span>

            {attachment ? (
              <div className="relative flex h-full min-h-[200px] w-full flex-col gap-2 rounded-[10px] border border-dashed border-[#d7dbe7] bg-white p-4">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${attachment.fileName}`}
                  onClick={handleRemoveAttachment}
                  className="absolute right-2 top-2 size-8 text-error hover:bg-error/10 hover:text-error"
                >
                  <Trash2 className="size-4" />
                </Button>
                <FileTypeIcon fileName={attachment.fileName} mimeType={attachment.mimeType} />
                <p
                  className="truncate pr-8 text-[13px] font-semibold text-[#0d0d12]"
                  title={attachment.fileName}
                >
                  {attachment.fileName}
                </p>
                <p className="text-xs text-[#666d80]">{formatFileSize(attachment.fileSize)}</p>
              </div>
            ) : scanState === 'uploading' ? (
              <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed border-[#d7dbe7] bg-white text-center">
                <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
                <p className="text-sm font-medium text-text-secondary">Scanning for PHI…</p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2 text-xs text-text-secondary">
                  <Checkbox
                    id="module-phi-attested"
                    checked={phiAttested}
                    onCheckedChange={(checked) => {
                      setPhiAttested(checked === true);
                      setUploadError(null);
                    }}
                    className="mt-0.5 size-4"
                  />
                  <label htmlFor="module-phi-attested" className="cursor-pointer">
                    I verify this document contains no Personal Health Information (PHI).
                  </label>
                </div>
                <FileUpload
                  onFilesSelected={handleFilesSelected}
                  accept=".pdf,.docx"
                  multiple={false}
                  className="min-h-[200px] rounded-[10px] border-[#d7dbe7] bg-white p-6"
                  label={
                    <>
                      Drop your files here or{' '}
                      <span className="text-primary underline">Upload file</span>
                    </>
                  }
                  description="Supported formats: PDF, DOCX"
                  error={uploadError ?? undefined}
                />
              </>
            )}
          </div>
        </div>

        {scanState === 'clean' && (
          <div
            role="status"
            className="mt-5 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm"
          >
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <p className="text-foreground">
              <span className="font-semibold text-success">SUCCESS:</span> No Protected Health
              Information (PHI) detected. Uploads are not subject to HIPAA restrictions. Authorized
              sharing is permitted.
            </p>
          </div>
        )}

        {scanState === 'phi' && (
          <div
            role="alert"
            className="mt-5 overflow-hidden rounded-lg border border-warning/40 text-sm"
          >
            <p className="bg-warning px-4 py-2 font-bold text-[#0d0d12]">PHI WARNING</p>
            <div className="flex items-start gap-3 bg-error/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-error" aria-hidden="true" />
              <div className="flex flex-col gap-1 text-foreground">
                <p>
                  <span className="font-semibold text-error">WARNING:</span> Protected Health
                  Information (PHI) detected. Ensure all uploads comply with HIPAA regulations.
                  Unauthorized disclosure is strictly prohibited.
                </p>
                <p className="text-text-secondary">
                  This document was not saved. Upload a document with no PHI to continue.
                </p>
              </div>
            </div>
          </div>
        )}

        {formError && <p className="mt-4 text-sm text-error">{formError}</p>}

        <Button
          variant="ghost"
          onClick={handleAddModule}
          className="mt-5 h-12 w-full rounded-[10px] border border-[#e5e7ea] bg-white text-sm font-medium text-[#0d0d12] hover:bg-[#f1f3f9]"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add module
        </Button>
      </section>
    </div>
  );
}
