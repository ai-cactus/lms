'use client';

import React, { useEffect, useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Mail, Trash2, PlusCircle, FileSpreadsheet, Download } from 'lucide-react';
import { FileUpload } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Stepper from '@/components/onboarding/Stepper';
import { WORKER_ROLES, getRoleDisplayName } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import type { OnboardingData, OnboardingWorkerInvite } from '@/app/actions/onboarding-complete';
import {
  readStaffSpreadsheetRows,
  extractManagerInvitesFromRows,
  buildWorkerCsvTemplate,
  summariseSkippedCsvRows,
} from '@/lib/staff-csv';
import { Alert } from '@/components/ui';
import { logger } from '@/lib/logger';

interface WorkerInviteRow {
  email: string;
  role: string;
}

interface Step5FormData {
  invites: WorkerInviteRow[];
}

const WORKER_ROLE_OPTIONS: { value: Role; name: string }[] = WORKER_ROLES.map((role) => ({
  value: role,
  name: getRoleDisplayName(role),
}));

const ROLE_NAME_BY_VALUE = new Map(WORKER_ROLE_OPTIONS.map((o) => [o.value, o.name]));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY_ROW: WorkerInviteRow = { email: '', role: '' };

export default function OnboardingStep5() {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    register,
    getValues,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<Step5FormData>({
    defaultValues: { invites: [{ ...EMPTY_ROW }] },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'invites' });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [csvError, setCsvError] = useState('');
  const [csvWarning, setCsvWarning] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Block reaching the final step without step-1 org data: without it the submit
  // dead-ends on a "Missing Organization Data (Step 1)" error. Corrupt/unparseable
  // localStorage is treated as missing and sent back to step 1 to re-enter it.
  useEffect(() => {
    const raw = localStorage.getItem('onboarding_data');
    let missingStep1 = true;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        missingStep1 = !parsed.step1;
      } catch {
        missingStep1 = true;
      }
    }
    if (missingStep1) {
      router.replace('/onboarding/step1');
    }
  }, [router]);

  const collectValidInvites = (rows: WorkerInviteRow[]): OnboardingWorkerInvite[] => {
    const seen = new Set<string>();
    const result: OnboardingWorkerInvite[] = [];
    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(email) || seen.has(email)) continue;
      seen.add(email);
      result.push({ email, role: row.role });
    }
    return result;
  };

  const complete = async (workerInvites: OnboardingWorkerInvite[]) => {
    setSubmitError('');
    setIsLoading(true);
    try {
      let allData: Record<string, unknown> = {};
      if (typeof window !== 'undefined') {
        allData = JSON.parse(localStorage.getItem('onboarding_data') || '{}') as Record<
          string,
          unknown
        >;
      }
      allData.step5 = { workerInvites };

      logger.info({
        msg: '[onboarding] Submitting full onboarding data',
        stepCount: Object.keys(allData).length,
        inviteCount: workerInvites.length,
      });

      const { completeOnboarding } = await import('@/app/actions/onboarding-complete');
      const result = await completeOnboarding(allData as unknown as OnboardingData);

      if (!result.success) {
        // State lost mid-flight (after the mount guard passed) — recover by
        // sending the user back to re-enter step-1 org data instead of dead-ending.
        if (result.code === 'MISSING_STEP1') {
          router.replace('/onboarding/step1');
          return;
        }
        setSubmitError(result.error || 'Failed to complete onboarding');
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
      setSubmitError('System error completing onboarding');
      setIsLoading(false);
    }
  };

  const onSubmit = (data: Step5FormData) => {
    let hasMissingRole = false;
    data.invites.forEach((row, index) => {
      if (row.email.trim() && !row.role) {
        setError(`invites.${index}.role` as const, { type: 'required', message: 'Select a role' });
        hasMissingRole = true;
      }
    });
    if (hasMissingRole) return;

    complete(collectValidInvites(data.invites));
  };

  const handleSkip = () => {
    complete([]);
  };

  const handleCsvUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setCsvError('');
    try {
      const rows = await readStaffSpreadsheetRows(files[0]);
      const { invites, skipped } = extractManagerInvitesFromRows(rows, {
        validRoles: new Set(WORKER_ROLES as readonly string[]),
      });
      const skipSummary = summariseSkippedCsvRows(skipped);
      if (invites.length === 0) {
        setCsvError(
          skipSummary
            ? `No valid emails to import. ${skipSummary}.`
            : 'No valid emails found in the file. Please check the file format.',
        );
        return;
      }
      const current = getValues('invites').filter((r) => r.email.trim());
      replace([...current, ...invites.map(({ email, role }) => ({ email, role }))]);

      const warnings: string[] = [];
      if (skipSummary) warnings.push(skipSummary);
      const roleRejectedCount = invites.filter((inv) => inv.roleRejected).length;
      if (roleRejectedCount > 0) {
        warnings.push(
          `${roleRejectedCount} row${roleRejectedCount === 1 ? '' : 's'} had an unrecognised role — please select one below`,
        );
      }
      setCsvWarning(warnings.length > 0 ? `${warnings.join('. ')}.` : '');
      setIsModalOpen(false);
    } catch (err) {
      logger.error({ msg: '[onboarding] Worker CSV parse failed', err });
      setCsvError('Failed to parse file. Please check the format.');
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildWorkerCsvTemplate()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'workers-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
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
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4 rounded-2xl bg-background p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] md:gap-6 md:p-10"
      >
        <div className="hidden gap-4 md:flex">
          <span className="flex-1 text-sm font-semibold text-foreground">Email</span>
          <span className="w-[220px] text-sm font-semibold text-foreground">Roles</span>
          <span className="w-11" />
        </div>

        <div className="flex flex-col gap-4">
          {fields.map((row, index) => (
            <div key={row.id} className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
              <div className="flex-1">
                <Input
                  startIcon={<Mail aria-hidden="true" />}
                  placeholder="Enter worker's email"
                  type="email"
                  {...register(`invites.${index}.email` as const)}
                />
              </div>
              <div className="md:w-[220px]">
                <Controller
                  name={`invites.${index}.role` as const}
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        clearErrors(`invites.${index}.role` as const);
                      }}
                    >
                      <SelectTrigger
                        className="h-14 w-full rounded-[10px]"
                        aria-invalid={!!errors.invites?.[index]?.role}
                      >
                        {field.value ? (
                          <span className="text-foreground">
                            {ROLE_NAME_BY_VALUE.get(field.value as Role) ?? field.value}
                          </span>
                        ) : (
                          <SelectValue placeholder="Select role" />
                        )}
                      </SelectTrigger>
                      <SelectContent className="max-w-[320px]">
                        {WORKER_ROLE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span className="font-medium text-foreground">{option.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.invites?.[index]?.role && (
                  <p className="mt-1.5 text-sm text-error">
                    {errors.invites[index]?.role?.message}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => remove(index)}
                disabled={fields.length === 1}
                className="text-text-tertiary hover:text-error"
                aria-label="Remove row"
              >
                <Trash2 className="size-5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <button
            type="button"
            onClick={() => append({ ...EMPTY_ROW })}
            className="flex items-center gap-1.5 text-sm font-semibold text-primary cursor-pointer"
          >
            <PlusCircle className="size-4" aria-hidden="true" />
            Add team member
          </button>
          <button
            type="button"
            onClick={() => {
              setCsvError('');
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 text-sm font-semibold text-primary cursor-pointer"
          >
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            Import with .csv file instead
          </button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            <Download className="size-4" aria-hidden="true" />
            Download sample .csv template
          </button>
        </div>

        {csvWarning && (
          <Alert variant="warning" title="Some rows need attention">
            {csvWarning}
          </Alert>
        )}

        {submitError && <p className="text-sm text-error">{submitError}</p>}

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
              onClick={handleSkip}
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

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upload .csv file</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-text-secondary">
            Add multiple workers from a CSV with an <span className="font-medium">email</span>{' '}
            column and an optional <span className="font-medium">role</span> column.
          </p>

          <div className="h-60">
            <FileUpload
              onFilesSelected={handleCsvUpload}
              multiple={false}
              accept=".csv,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              description=".csv or .xlsx files only."
              error={csvError || undefined}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
