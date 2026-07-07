'use client';

import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { FileText, Trash2 } from 'lucide-react';
import { FileUpload } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Stepper from '@/components/onboarding/Stepper';
import { logger } from '@/lib/logger';

interface Step2FormData {
  licenseNumber: string;
  hipaaCompliant: string;
}

export default function OnboardingStep2() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Step2FormData>();
  const [files, setFiles] = useState<File[]>([]);

  const onSubmit = (data: Step2FormData) => {
    logger.info({ msg: '[onboarding] Step 2 saved locally', fieldCount: Object.keys(data).length });
    try {
      // Save to localStorage
      if (typeof window !== 'undefined') {
        const existing = JSON.parse(localStorage.getItem('onboarding_data') || '{}');
        const updated = { ...existing, step2: data };
        localStorage.setItem('onboarding_data', JSON.stringify(updated));
      }
      router.push('/onboarding/step3');
    } catch (error) {
      logger.error({ msg: 'Local save error:', err: error });
    }
  };

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getError = (fieldName: keyof Step2FormData) => {
    return errors[fieldName]?.message;
  };

  const getFileIconClass = (file: File) => {
    if (file.type === 'application/pdf') return 'text-error'; // Red for PDF
    if (
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.type === 'application/msword'
    )
      return 'text-primary'; // Blue for DOCX
    return 'text-text-secondary'; // Gray for others
  };

  return (
    <div className="w-full max-w-[1000px]">
      <Stepper currentStep={2} />

      <h1 className="mb-2 text-center text-[22px] font-bold text-foreground md:text-[28px]">
        Credentialing &amp; Documentation
      </h1>
      <p className="mb-6 text-center text-sm text-text-secondary md:mb-12 md:text-base">
        Provide key details about your licenses and documentation to ensure accurate assessments.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4 rounded-2xl bg-background p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] md:gap-6 md:p-10"
      >
        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <Field label="State Healthcare License Number" helperText="(optional)">
              <Input
                {...register('licenseNumber')}
                placeholder="Enter your official license number"
              />
            </Field>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Controller
              name="hipaaCompliant"
              control={control}
              rules={{ required: 'Compliance confirmation is required' }}
              render={({ field }) => (
                <Field
                  label="HIPAA Compliance Confirmation"
                  required
                  error={getError('hipaaCompliant')}
                >
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-14 w-full rounded-[10px]">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-foreground">
            Upload your compliance certifications{' '}
            <span className="text-xs text-text-tertiary">(optional)</span>
          </label>
          <FileUpload
            onFilesSelected={handleFilesSelected}
            multiple={true}
            accept=".pdf,.docx,.jpg,.png"
          />

          {files.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-lg border border-border bg-background p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                      <FileText className={`size-5 ${getFileIconClass(file)}`} aria-hidden="true" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">{file.name}</span>
                      <span className="text-xs text-text-tertiary">
                        {formatFileSize(file.size)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => removeFile(index)}
                    className="text-error"
                  >
                    <Trash2 className="size-[18px]" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-between md:gap-4">
          <Button
            variant="outline"
            type="button"
            onClick={() => router.push('/onboarding/step1')}
            className="w-full md:w-auto"
          >
            Back
          </Button>
          <Button type="submit" className="w-full md:w-auto">
            Next
          </Button>
        </div>
      </form>
    </div>
  );
}
