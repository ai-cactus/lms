'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { FileText } from 'lucide-react';
import { uploadDocument } from '@/app/actions/documents';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';

export default function UploadModal({ onClose }: { onClose: () => void }) {
  const [state, action, isPending] = useActionState(uploadDocument, null);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.success) {
      // Optional: reset file immediately so user sees it's gone
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset local state after successful form action
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Close modal after delay
      const timer = setTimeout(() => {
        onClose();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [state, onClose]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    setValidationError(null);
    setFile(null);

    if (!selected) return;

    // Validate Size (10MB)
    if (selected.size > 10 * 1024 * 1024) {
      setValidationError('File exceeds 10MB limit.');
      e.target.value = ''; // Clear input
      return;
    }

    // Validate Type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    // Also check extension as backup
    const validExtension = /\.(pdf|docx|doc)$/i.test(selected.name);

    if (!allowedTypes.includes(selected.type) && !validExtension) {
      setValidationError('Only PDF and DOCX files are allowed.');
      e.target.value = '';
      return;
    }

    setFile(selected);
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
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>

        <form action={action} className="flex flex-col gap-6">
          <div className="relative rounded-[10px] border-2 border-dashed border-border p-8 text-center">
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              onChange={handleFileChange}
              accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
              required
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            {file ? (
              <div className="flex items-center justify-center gap-2.5">
                <FileText className="size-6 text-primary" aria-hidden="true" />
                <p className="m-0">{file.name}</p>
              </div>
            ) : (
              <p>Drag &amp; drop or Click to Select (PDF, DOCX - Max 10MB)</p>
            )}
          </div>

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
          {state?.error && (
            <Alert variant="error" title={state.phiDetected ? 'PHI Detected' : undefined}>
              {state.error}
            </Alert>
          )}

          {state?.success && !state.phiDetected && (
            <Alert variant="success" title="Success">
              <strong>SUCCESS:</strong> No Protected Health Information (PHI) detected. Uploads are
              not subject to HIPAA restrictions. Authorized sharing is permitted.
            </Alert>
          )}

          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isPending}
              disabled={!file || isPending || !!validationError || !agreed}
            >
              {isPending ? 'Scanning for PHI…' : 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
