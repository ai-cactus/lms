'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { attestCourse } from '@/app/actions/course';
import { issueCertificate } from '@/app/actions/certificate';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

interface AttestationModalProps {
  isOpen: boolean;
  onClose: () => void;
  enrollmentId: string;
  courseName: string;
  userEmail: string;
  onSuccess: (certificateId?: string) => void;
}

export default function AttestationModal({
  isOpen,
  onClose,
  enrollmentId,
  userEmail,
  onSuccess,
}: AttestationModalProps) {
  const [signature, setSignature] = useState('');
  const [confirmed1, setConfirmed1] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    setIsSubmitting(true);

    try {
      await attestCourse(enrollmentId, signature, '');
      const certificate = await issueCertificate(enrollmentId);
      onSuccess(certificate.id);
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || 'Failed to attest. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = signature.trim() !== '' && confirmed1 && confirmed2;
  const effectiveDate = new Date().toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle className="text-lg font-bold text-foreground">
            Training Attestation of Understanding and Compliance
          </DialogTitle>
          <p className="text-sm text-text-secondary">
            You are required to sign this document to confirm you have reviewed this compliance
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <Alert variant="error" className="mb-3">
              {error}
            </Alert>
          )}

          <div className="mb-5">
            <label
              htmlFor="attestation-name"
              className="mb-2 block text-sm font-semibold text-foreground"
            >
              Name
            </label>
            <Input
              id="attestation-name"
              className="h-11"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
            />
            {userEmail && <div className="mt-1 text-xs text-text-tertiary">{userEmail}</div>}
          </div>

          <div className="mb-5 rounded-md border border-border bg-bg-secondary p-4">
            <div className="mb-4 flex items-start gap-3">
              <Checkbox
                id="attestation-confirm-1"
                className="mt-1"
                checked={confirmed1}
                onCheckedChange={(c) => setConfirmed1(c === true)}
              />
              <label
                htmlFor="attestation-confirm-1"
                className="cursor-pointer text-sm leading-relaxed text-foreground"
              >
                I hereby certify that I have successfully completed the training module referenced
                above, including all associated learning materials and the required knowledge
                assessment.
                <br />
                By submitting this electronic signature, I solemnly attest to the following:
                <ol className="mt-2 pl-5">
                  <li>
                    1. Competency: I have read and fully comprehended the training content. I
                    acknowledge my responsibility to perform my duties in strict accordance with
                    these requirements.
                  </li>
                  <li>
                    2. Application &amp; Policy: I will integrate these principles into my daily
                    practice and consistently adhere to all related organizational policies,
                    procedures, and applicable state/federal regulatory standards.
                  </li>
                  <li>
                    3. Proactive Clarification: If I encounter a situation where I am uncertain of
                    the correct protocol, I agree to seek immediate guidance from my supervisor or
                    the Compliance Department before proceeding.
                  </li>
                  <li>
                    4. Professional Accountability: I understand that maintaining this competency is
                    a condition of my employment/engagement. I acknowledge that failure to comply
                    with these standards may result in disciplinary action, up to and including
                    termination of my contract or employment.
                  </li>
                </ol>
              </label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="attestation-confirm-2"
                className="mt-1"
                checked={confirmed2}
                onCheckedChange={(c) => setConfirmed2(c === true)}
              />
              <label
                htmlFor="attestation-confirm-2"
                className="cursor-pointer text-sm leading-relaxed text-foreground"
              >
                I confirm that I have read the above statements and that this attestation is true,
                accurate, and provided of my own free will.
              </label>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-md bg-[#edf2f7] p-3 text-sm text-text-secondary">
            <Calendar className="size-5 text-success" aria-hidden="true" />
            Effective date: <strong>{effectiveDate}</strong>
          </div>
        </div>

        <DialogFooter className="border-t border-border p-5 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            loading={isSubmitting}
            className="flex-1"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
