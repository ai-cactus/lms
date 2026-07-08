'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Trash2, PlusCircle, Download } from 'lucide-react';
import { FileUpload, TagInput } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Stepper from '@/components/onboarding/Stepper';
import type { OnboardingData } from '@/app/actions/onboarding-complete';
import {
  readStaffSpreadsheetRows,
  extractStaffEmailsFromRows,
  buildStaffCsvTemplate,
} from '@/lib/staff-csv';
import { logger } from '@/lib/logger';

const MAX_CSV_BYTES = 1024 * 1024; // 1 MB

export default function OnboardingStep5() {
  const router = useRouter();
  const [emails, setEmails] = useState<string[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvEmails, setCsvEmails] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingEmails, setPendingEmails] = useState<string[]>([]);
  const [modalError, setModalError] = useState('');

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const complete = async (workerEmails: string[]) => {
    setError('');
    setIsLoading(true);
    try {
      let allData: Record<string, unknown> = {};
      if (typeof window !== 'undefined') {
        allData = JSON.parse(localStorage.getItem('onboarding_data') || '{}') as Record<
          string,
          unknown
        >;
      }
      allData.step5 = { workerEmails };

      logger.info({
        msg: '[onboarding] Submitting full onboarding data',
        stepCount: Object.keys(allData).length,
        inviteCount: workerEmails.length,
      });

      const { completeOnboarding } = await import('@/app/actions/onboarding-complete');
      const result = await completeOnboarding(allData as unknown as OnboardingData);

      if (!result.success) {
        setError(result.error || 'Failed to complete onboarding');
        setIsLoading(false);
        return;
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('onboarding_data');
        localStorage.removeItem('onboarding_org_id');
      }

      router.push('/onboarding/complete');
    } catch (e) {
      logger.error({ msg: 'Error completing onboarding', err: e });
      setError('System error completing onboarding');
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    complete([...emails, ...csvEmails]);
  };

  const handleModalFileSelected = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setModalError('');

    if (file.size > MAX_CSV_BYTES) {
      setModalError('File is too large. Maximum size is 1MB.');
      return;
    }

    try {
      const rows = await readStaffSpreadsheetRows(file);
      const { validEmails } = extractStaffEmailsFromRows(rows);
      if (validEmails.length === 0) {
        setModalError('No valid emails found in the file. Please check the file format.');
        return;
      }
      setPendingFile(file);
      setPendingEmails(validEmails);
    } catch (err) {
      logger.error({ msg: 'Error parsing file:', err });
      setModalError('Failed to parse file. Please check the format.');
    }
  };

  const confirmCsv = () => {
    if (!pendingFile || pendingEmails.length === 0) return;
    setCsvFile(pendingFile);
    setCsvEmails(pendingEmails);
    setEmails([]);
    closeModal();
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setPendingFile(null);
    setPendingEmails([]);
    setModalError('');
  };

  const removeCsv = () => {
    setCsvFile(null);
    setCsvEmails([]);
  };

  return (
    <div className="w-full max-w-[1000px]">
      <Stepper currentStep={5} />

      <h1 className="mb-2 text-center text-[22px] font-bold text-foreground md:text-[28px]">
        Invite your Workers/Staffs
      </h1>
      <p className="mb-6 text-center text-sm text-text-secondary md:mb-12 md:text-base">
        Add your team so they can access assigned trainings and complete compliance requirements.
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-2xl bg-background p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] md:gap-6 md:p-10"
      >
        {!csvFile ? (
          <>
            <TagInput
              value={emails}
              onChange={(newEmails) => {
                setEmails(newEmails);
                if (newEmails.length > 0) setError('');
              }}
              placeholder="Add emails separated with commas to invite"
              validate={validateEmail}
              error={error}
            />

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-primary"
              >
                <PlusCircle className="size-4" aria-hidden="true" />
                Import with .csv file instead
              </button>
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([buildStaffCsvTemplate()], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = 'workers-template.csv';
                  anchor.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex items-center gap-1.5 text-sm font-semibold text-primary"
              >
                <Download className="size-4" aria-hidden="true" />
                Download sample .csv template
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-success text-white">
                <FileSpreadsheet className="size-5" aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{csvFile.name}</span>
                <span className="text-xs text-text-tertiary">
                  {formatFileSize(csvFile.size)} · {csvEmails.length} email
                  {csvEmails.length !== 1 ? 's' : ''}
                </span>
                <span className="text-xs font-medium text-success">Upload completed!</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={removeCsv}
              className="text-error hover:bg-error/10"
              aria-label="Remove CSV file"
            >
              <Trash2 className="size-[18px]" aria-hidden="true" />
            </Button>
          </div>
        )}

        {error && csvFile && <p className="text-sm text-error">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
          <Button
            variant="outline"
            type="button"
            onClick={() => router.push('/onboarding/step4')}
            disabled={isLoading}
            className="w-full md:w-auto"
          >
            Back
          </Button>
          <div className="flex flex-col-reverse items-center gap-3 md:flex-row md:gap-4">
            <button
              type="button"
              onClick={() => complete([])}
              disabled={isLoading}
              className="text-sm font-semibold text-text-secondary hover:text-foreground disabled:opacity-50"
            >
              Skip for now
            </button>
            <Button type="submit" loading={isLoading} className="w-full md:w-auto">
              Next
            </Button>
          </div>
        </div>
      </form>

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upload .csv file</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-text-secondary">
            You can add multiple staffs from an uploaded csv file
          </p>

          {pendingFile ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-success text-white">
                  <FileSpreadsheet className="size-5" aria-hidden="true" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{pendingFile.name}</span>
                  <span className="text-xs text-text-tertiary">
                    {formatFileSize(pendingFile.size)} · {pendingEmails.length} email
                    {pendingEmails.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs font-medium text-success">Upload completed!</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => {
                  setPendingFile(null);
                  setPendingEmails([]);
                }}
                className="text-error hover:bg-error/10"
                aria-label="Remove pending file"
              >
                <Trash2 className="size-[18px]" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="h-60">
              <FileUpload
                onFilesSelected={handleModalFileSelected}
                multiple={false}
                accept=".csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                description=".csv file only (1MB max.)"
                error={modalError || undefined}
              />
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            onClick={confirmCsv}
            disabled={pendingEmails.length === 0}
          >
            Continue
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
