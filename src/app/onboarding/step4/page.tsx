'use client';

import React, { useState } from 'react';
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
import { MANAGER_INVITE_ROLES } from '@/lib/rbac/role-utils';
import {
  readStaffSpreadsheetRows,
  extractManagerInvitesFromRows,
  buildManagerCsvTemplate,
} from '@/lib/staff-csv';
import { logger } from '@/lib/logger';

interface ManagerInviteRow {
  email: string;
  role: string;
}

interface Step4FormData {
  invites: ManagerInviteRow[];
}

const MANAGER_ROLE_OPTIONS: { value: string; name: string; description: string }[] = [
  { value: 'supervisor', name: 'Supervisor', description: 'Full facility access except billing.' },
  {
    value: 'hr',
    name: 'HR',
    description:
      'Manage staff, assign general courses, and view completion metrics. No billing or clinical scores.',
  },
  {
    value: 'clinical_director',
    name: 'Clinical Director',
    description:
      'Build clinical modules, assign clinical paths, and view granular assessment scores. No billing.',
  },
  {
    value: 'finance',
    name: 'Finance',
    description: 'Manage billing, subscription, payment methods, and invoices only.',
  },
];

const ROLE_NAME_BY_VALUE = new Map(MANAGER_ROLE_OPTIONS.map((o) => [o.value, o.name]));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY_ROW: ManagerInviteRow = { email: '', role: '' };

export default function OnboardingStep4() {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    register,
    getValues,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<Step4FormData>({
    defaultValues: { invites: [{ ...EMPTY_ROW }] },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'invites' });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [csvError, setCsvError] = useState('');

  const persistAndAdvance = (invites: ManagerInviteRow[]) => {
    if (typeof window !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('onboarding_data') || '{}');
      const updated = { ...existing, step4: { managerInvites: invites } };
      localStorage.setItem('onboarding_data', JSON.stringify(updated));
    }
    router.push('/onboarding/step5');
  };

  const collectValidInvites = (rows: ManagerInviteRow[]): ManagerInviteRow[] => {
    const seen = new Set<string>();
    const result: ManagerInviteRow[] = [];
    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(email) || seen.has(email)) continue;
      seen.add(email);
      result.push({ email, role: row.role });
    }
    return result;
  };

  const onSubmit = (data: Step4FormData) => {
    // Block advancing when a row has an email but no role — fully empty rows are
    // ignored (they are simply dropped by collectValidInvites).
    let hasMissingRole = false;
    data.invites.forEach((row, index) => {
      if (row.email.trim() && !row.role) {
        setError(`invites.${index}.role` as const, { type: 'required', message: 'Select a role' });
        hasMissingRole = true;
      }
    });
    if (hasMissingRole) return;

    logger.info({ msg: '[onboarding] Step 4 saved locally', rowCount: data.invites.length });
    persistAndAdvance(collectValidInvites(data.invites));
  };

  const handleSkip = () => {
    persistAndAdvance([]);
  };

  const handleCsvUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setCsvError('');
    try {
      const rows = await readStaffSpreadsheetRows(files[0]);
      const { invites } = extractManagerInvitesFromRows(rows, {
        validRoles: new Set(MANAGER_INVITE_ROLES as readonly string[]),
      });
      if (invites.length === 0) {
        setCsvError('No valid emails found in the file. Please check the file format.');
        return;
      }
      const current = getValues('invites').filter((r) => r.email.trim());
      replace([...current, ...invites]);
      setIsModalOpen(false);
    } catch (error) {
      logger.error({ msg: '[onboarding] Manager CSV parse failed', err: error });
      setCsvError('Failed to parse file. Please check the format.');
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildManagerCsvTemplate()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'managers-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-[1000px]">
      <Stepper currentStep={4} />

      <h1 className="mb-2 text-center text-[22px] font-bold text-foreground md:text-[28px]">
        Invite your managers
      </h1>
      <p className="mb-6 text-center text-sm text-text-secondary md:mb-12 md:text-base">
        Invite the people who help you run this facility.
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
                  placeholder="Enter manager's email"
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
                        className="h-14 w-full rounded-[10px] *:data-[slot=select-value]:min-w-0"
                        aria-invalid={!!errors.invites?.[index]?.role}
                      >
                        <SelectValue placeholder="Select role">
                          {field.value ? (
                            <span className="min-w-0 truncate text-foreground">
                              {ROLE_NAME_BY_VALUE.get(field.value) ?? field.value}
                            </span>
                          ) : null}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-w-[320px] p-1">
                        {MANAGER_ROLE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-foreground">{option.name}</span>
                              <span className="text-xs text-text-tertiary">
                                {option.description}
                              </span>
                            </div>
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
            className="flex items-center gap-1.5 text-sm font-semibold text-primary cursor-pointer"
          >
            <Download className="size-4" aria-hidden="true" />
            Download sample .csv template
          </button>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
          <Button
            variant="outline"
            type="button"
            onClick={() => router.push('/onboarding/step3')}
            className="w-full md:w-auto"
          >
            Back
          </Button>
          <div className="flex flex-col-reverse items-center gap-3 md:flex-row md:gap-4">
            <button
              type="button"
              onClick={handleSkip}
              className="text-sm font-semibold text-text-secondary hover:text-foreground"
            >
              Skip for now
            </button>
            <Button type="submit" className="w-full md:w-auto">
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
            Add multiple managers from a CSV with an <span className="font-medium">email</span>{' '}
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
