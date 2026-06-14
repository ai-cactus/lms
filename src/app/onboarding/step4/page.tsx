'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusCircle, FileSpreadsheet, Trash2 } from 'lucide-react';
import { FileUpload, TagInput } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Stepper from '@/components/onboarding/Stepper';
import * as XLSX from 'xlsx';
import type { OnboardingData } from '@/app/actions/onboarding-complete';
import { logger } from '@/lib/logger';

export default function OnboardingStep4() {
  const router = useRouter();
  const [emails, setEmails] = useState<string[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [csvEmails, setCsvEmails] = useState<string[]>([]);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Combine manual emails and CSV emails
    const allEmails = [...emails, ...csvEmails];

    setIsLoading(true);

    try {
      // 1. Gather all data
      let allData: Record<string, unknown> = {};
      if (typeof window !== 'undefined') {
        allData = JSON.parse(localStorage.getItem('onboarding_data') || '{}') as Record<
          string,
          unknown
        >;
      }

      // Add Step 4 data
      allData.step4 = { workerEmails: allEmails };

      logger.info({ msg: 'Submitting Full Onboarding Data:', data: allData });

      // 2. Call Server Action
      const { completeOnboarding } = await import('@/app/actions/onboarding-complete');
      const result = await completeOnboarding(allData as unknown as OnboardingData);

      if (!result.success) {
        setError(result.error || 'Failed to complete onboarding');
        setIsLoading(false);
        return;
      }

      // 3. Clear Storage
      if (typeof window !== 'undefined') {
        localStorage.removeItem('onboarding_data');
        // Remove old keys if any
        localStorage.removeItem('onboarding_org_id');
      }

      router.push('/onboarding/complete');
    } catch (e) {
      logger.error({ msg: 'Error completing onboarding', err: e });
      setError('System error completing onboarding');
      setIsLoading(false);
      return;
    }
  };

  const handleCsvUpload = async (files: File[]) => {
    if (files.length === 0) return;

    const file = files[0];
    setIsLoading(true);
    setError('');

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });

      // Get first sheet
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

      // Find email column (look for header or just use first column with emails)
      const extractedEmails: string[] = [];

      for (const row of jsonData) {
        if (Array.isArray(row)) {
          for (const cell of row) {
            if (typeof cell === 'string' && validateEmail(cell.trim())) {
              extractedEmails.push(cell.trim().toLowerCase());
            }
          }
        }
      }

      // Remove duplicates
      const uniqueEmails = [...new Set(extractedEmails)];

      if (uniqueEmails.length === 0) {
        setError('No valid emails found in the file. Please check the file format.');
        setIsLoading(false);
        return;
      }

      setCsvFile(file);
      setCsvEmails(uniqueEmails);
      setIsModalOpen(false);
      setEmails([]); // Clear manual input if CSV is used
    } catch (err) {
      logger.error({ msg: 'Error parsing file:', err: err });
      setError('Failed to parse file. Please check the format.');
    }

    setIsLoading(false);
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
            <div className="flex flex-col gap-2">
              <TagInput
                value={emails}
                onChange={(newEmails) => {
                  setEmails(newEmails);
                  if (newEmails.length > 0) {
                    setError('');
                  }
                }}
                placeholder="Type email and press Enter..."
                validate={validateEmail}
                error={error}
              />
            </div>

            <Button
              variant="ghost"
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="w-fit gap-2 px-0 font-semibold text-primary"
            >
              <PlusCircle className="size-5" aria-hidden="true" />
              Import with .csv file instead
            </Button>
          </>
        ) : (
          <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-md bg-success text-white">
                <FileSpreadsheet className="size-5" aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{csvFile.name}</span>
                <span className="text-xs text-success">
                  {csvEmails.length} email{csvEmails.length !== 1 ? 's' : ''} found
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={removeCsv}
              className="text-error"
            >
              <Trash2 className="size-[18px]" aria-hidden="true" />
            </Button>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-between md:gap-4">
          <Button
            variant="outline"
            type="button"
            onClick={() => router.push('/onboarding/step3')}
            className="w-full md:w-auto"
          >
            Back
          </Button>
          <Button type="submit" disabled={isLoading} className="w-full md:w-auto">
            Complete Onboarding
          </Button>
        </div>
      </form>

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) setIsModalOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upload .csv file</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-text-secondary">
            You can add multiple staffs from an uploaded csv file
          </p>

          <div className="h-60">
            <FileUpload
              onFilesSelected={handleCsvUpload}
              multiple={false}
              accept=".csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              description=".csv or .xls files only. 10MB max."
            />
          </div>

          <Button type="button" className="w-full" onClick={() => {}}>
            Continue
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
