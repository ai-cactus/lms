import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface PhiErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  reason?: string;
}

export default function PhiErrorModal({ isOpen, onClose, onRetry, reason }: PhiErrorModalProps) {
  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col items-center px-4 py-6 text-center">
          <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-error/10">
            <TriangleAlert className="size-8 text-error" aria-hidden="true" />
          </div>

          <DialogTitle className="mb-3 text-xl font-semibold text-foreground">
            PHI Detected
          </DialogTitle>

          <p className="mb-8 max-w-[360px] text-[15px] leading-normal text-text-secondary">
            Personal Health Information (PHI) has been detected in this document. Please upload a
            valid document for analysis.
            {reason && (
              <span className="mt-3 block rounded-md bg-error/5 px-3 py-2 text-sm text-error">
                <strong>Reason:</strong> {reason}
              </span>
            )}
          </p>

          <Button onClick={onRetry} variant="default" className="w-full max-w-[300px]">
            Upload another document
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
