'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bell, CalendarDays, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { updateDigestFrequency } from '@/app/actions/notification-settings';
import { cn } from '@/lib/utils';
import type { DigestFrequency } from '@/generated/prisma/enums';

interface NotificationSettingsTabProps {
  digestFrequency: DigestFrequency;
}

const digestFrequencySchema = z.object({
  frequency: z.enum(['daily', 'weekly']),
});

type NotificationFormValues = z.infer<typeof digestFrequencySchema>;

const FREQUENCY_OPTIONS: {
  value: DigestFrequency;
  label: string;
  description: string;
  icon: typeof Sun;
}[] = [
  {
    value: 'daily',
    label: 'Daily',
    description: 'Batched updates sent every morning',
    icon: Sun,
  },
  {
    value: 'weekly',
    label: 'Weekly',
    description: 'Batched updates sent Monday mornings',
    icon: CalendarDays,
  },
];

export default function NotificationSettingsTab({ digestFrequency }: NotificationSettingsTabProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting },
  } = useForm<NotificationFormValues>({
    resolver: zodResolver(digestFrequencySchema),
    defaultValues: { frequency: digestFrequency },
  });

  const onSubmit = async (values: NotificationFormValues) => {
    setMessage(null);
    const result = await updateDigestFrequency({ frequency: values.frequency });

    if (result.success) {
      setMessage({ type: 'success', text: 'Notification settings updated.' });
      reset(values);
      router.refresh();
    } else {
      setMessage({
        type: 'error',
        text: result.error ?? 'Failed to update notification settings.',
      });
    }
  };

  return (
    <div className="flex flex-col">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-[#101928]">Notification digests</h2>
        <p className="text-sm text-[#667085]">
          Choose how often your managers receive the batched summary of routine activity across the
          organization.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-5 rounded-2xl border border-[#eceef2] bg-background p-6"
      >
        <Controller
          name="frequency"
          control={control}
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              {FREQUENCY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = field.value === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border-[1.5px] border-[#e5e7ea] p-4 transition-colors',
                      isSelected && 'border-primary bg-primary/5',
                    )}
                  >
                    <RadioGroupItem value={option.value} className="mt-0.5" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2 text-[15px] font-semibold text-[#101928]">
                        <Icon className="size-4 text-primary" aria-hidden="true" />
                        {option.label}
                      </span>
                      <span className="text-[13px] text-[#667085]">{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          )}
        />

        <div className="flex items-start gap-3 rounded-xl bg-[#f9fafb] px-4 py-3.5">
          <Bell className="mt-0.5 size-4 shrink-0 text-[#667085]" aria-hidden="true" />
          <div className="flex flex-col gap-1 text-[13px] text-[#475367]">
            <span className="font-medium text-[#101928]">What gets batched</span>
            <span>
              Staff additions and document uploads are grouped into a single email summary. Critical
              alerts — such as a notification redirected because a role is unassigned — are always
              sent immediately.
            </span>
          </div>
        </div>

        {message && <Alert variant={message.type}>{message.text}</Alert>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            type="button"
            className="rounded-xl border-[#e4e7ec] font-semibold text-[#475367]"
            onClick={() => {
              reset();
              setMessage(null);
            }}
            disabled={!isDirty || isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="rounded-xl font-semibold"
            loading={isSubmitting}
            disabled={!isDirty}
          >
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
