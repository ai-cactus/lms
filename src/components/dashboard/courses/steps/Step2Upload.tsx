'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import FileUpload from '@/components/ui/FileUpload';
import { uploadDocument } from '@/app/actions/documents';
import { formatFileSize } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { CourseWizardModuleDocument } from '@/types/course';
import { wizardCardLabelClass, wizardSubtitleClass, wizardTitleClass } from './wizardFormClasses';

type ScanState = 'idle' | 'uploading' | 'clean' | 'phi';

interface Step2UploadProps {
  /** The attached document. This step owns no draft — the attachment IS the state. */
  document: CourseWizardModuleDocument | null;
  onDocumentChange: (document: CourseWizardModuleDocument | null) => void;
  onUploadingChange?: (isUploading: boolean) => void;
  /**
   * Document from the `?documentId=` deep link, seeding the upload slot. Read
   * once, on mount — the wizard re-keys this step when it resolves.
   */
  initialDocument?: CourseWizardModuleDocument | null;
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

export default function Step2Upload({
  document,
  onDocumentChange,
  onUploadingChange,
  initialDocument,
}: Step2UploadProps) {
  const [phiAttested, setPhiAttested] = useState(false);
  const [scanState, setScanState] = useState<ScanState>(
    document || initialDocument ? 'clean' : 'idle',
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const hasSeededLinkedDocument = useRef(false);

  // Seeding runs exactly once: without the ref, removing the deep-linked
  // document would immediately re-attach it.
  useEffect(() => {
    if (hasSeededLinkedDocument.current) return;
    hasSeededLinkedDocument.current = true;
    if (initialDocument && !document) onDocumentChange(initialDocument);
  }, [initialDocument, document, onDocumentChange]);

  const isUploading = scanState === 'uploading';
  useEffect(() => {
    onUploadingChange?.(isUploading);
  }, [isUploading, onUploadingChange]);

  const handleFilesSelected = async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setUploadError(null);

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
      // is cleared too — the course needs a clean document before it can advance.
      if (result.phiDetected) {
        logger.warn({ msg: '[course] Training document rejected — PHI detected' });
        onDocumentChange(null);
        setScanState('phi');
        return;
      }

      if (result.error) {
        setScanState('idle');
        setUploadError(result.error);
        return;
      }

      // Fail loudly rather than resolving the upload by filename: documents are
      // org-wide, so a colleague's identically-named file could be attached and
      // the course generated from their material. A retry is the better outcome.
      const { document: uploaded } = result;
      if (!uploaded) {
        logger.error({ msg: '[course] Upload reported success without a document' });
        setScanState('idle');
        setUploadError('The uploaded document could not be attached. Please try again.');
        return;
      }

      onDocumentChange({
        documentId: uploaded.id,
        fileName: uploaded.filename,
        fileSize: uploaded.size,
        mimeType: uploaded.mimeType,
      });
      setScanState('clean');
      logger.info({ msg: '[course] Training document uploaded', documentId: uploaded.id });
    } catch (err) {
      logger.error({ msg: '[course] Training document upload failed', err });
      setScanState('idle');
      setUploadError('Upload failed. Please try again.');
    }
  };

  const handleRemoveAttachment = () => {
    onDocumentChange(null);
    setScanState('idle');
    setUploadError(null);
  };

  return (
    <div className="flex w-full flex-col gap-8 md:gap-10">
      <div className="flex flex-col items-center gap-3">
        <h2 className={wizardTitleClass}>Upload Training Documents</h2>
        <p className={wizardSubtitleClass}>
          Upload the policy or procedure this course should be built from. One document per course,
          scanned for Protected Health Information before it is stored.
        </p>
      </div>

      <section className="w-full rounded-[14px] border border-[#e9ebf2] bg-[#f8f9fc] p-5 md:p-6">
        <div className="flex flex-col gap-2">
          <span className={wizardCardLabelClass}>
            Upload Training Document <span className="text-error">*</span>
          </span>

          {document ? (
            <div className="relative flex h-full min-h-[200px] w-full flex-col gap-2 rounded-[10px] border border-dashed border-[#d7dbe7] bg-white p-4">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${document.fileName}`}
                onClick={handleRemoveAttachment}
                className="absolute right-2 top-2 size-8 text-error hover:bg-error/10 hover:text-error"
              >
                <Trash2 className="size-4" />
              </Button>
              <FileTypeIcon fileName={document.fileName} mimeType={document.mimeType} />
              <p
                className="truncate pr-8 text-[13px] font-semibold text-[#0d0d12]"
                title={document.fileName}
              >
                {document.fileName}
              </p>
              <p className="text-xs text-[#666d80]">{formatFileSize(document.fileSize)}</p>
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
                  id="upload-phi-attested"
                  checked={phiAttested}
                  onCheckedChange={(checked) => {
                    setPhiAttested(checked === true);
                    setUploadError(null);
                  }}
                  className="mt-0.5 size-4"
                />
                <label htmlFor="upload-phi-attested" className="cursor-pointer">
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
                    Drop your file here or{' '}
                    <span className="text-primary underline">Upload file</span>
                  </>
                }
                description="Supported formats: PDF, DOCX"
                error={uploadError ?? undefined}
              />
            </>
          )}
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
      </section>
    </div>
  );
}
