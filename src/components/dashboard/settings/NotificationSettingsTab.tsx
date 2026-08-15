'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  updateDigestFrequency,
  updateNotificationCategoryPreferences,
} from '@/app/actions/notification-settings';
import {
  ALWAYS_ON_NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_META,
  type NotificationCategoryPreferenceMap,
} from '@/lib/notifications/catalog';
import { cn } from '@/lib/utils';
import type { DigestFrequency } from '@/generated/prisma/enums';

interface NotificationSettingsTabProps {
  digestFrequency: DigestFrequency;
  categoryPreferences: NotificationCategoryPreferenceMap;
}

interface NotificationFormValues {
  frequency: DigestFrequency;
  categories: NotificationCategoryPreferenceMap;
}

const FREQUENCY_OPTIONS: { value: DigestFrequency; label: string; description: string }[] = [
  {
    value: 'realtime',
    label: 'Real-time',
    description: 'Summary sent as activity happens.',
  },
  {
    value: 'daily',
    label: 'Daily',
    description: 'Summary sent at the end of each day',
  },
  {
    value: 'weekly',
    label: 'Weekly',
    description: 'Summary sent every Monday morning.',
  },
];

const ROW_GRID_CLASS =
  'grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-3 px-4 py-4 sm:grid-cols-[1fr_6rem_11rem] sm:gap-4 sm:px-6';

export default function NotificationSettingsTab({
  digestFrequency,
  categoryPreferences,
}: NotificationSettingsTabProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { dirtyFields, isDirty, isSubmitting },
  } = useForm<NotificationFormValues>({
    defaultValues: { frequency: digestFrequency, categories: categoryPreferences },
  });

  const onSubmit = async (values: NotificationFormValues) => {
    setMessage(null);

    // Two sections, one Save. Each half only writes when it actually changed, so
    // toggling a category never rewrites the cadence (and vice versa).
    if (dirtyFields.frequency) {
      const result = await updateDigestFrequency({ frequency: values.frequency });
      if (!result.success) {
        setMessage({
          type: 'error',
          text: result.error ?? 'Failed to update notification settings.',
        });
        return;
      }
    }

    if (dirtyFields.categories) {
      const result = await updateNotificationCategoryPreferences({
        categories: NOTIFICATION_CATEGORY_META.filter(
          (meta) => meta.key !== ALWAYS_ON_NOTIFICATION_CATEGORY,
        ).map((meta) => ({
          category: meta.key,
          emailEnabled: values.categories[meta.key].emailEnabled,
          inAppEnabled: values.categories[meta.key].inAppEnabled,
        })),
      });
      if (!result.success) {
        setMessage({
          type: 'error',
          text: result.error ?? 'Failed to update notification settings.',
        });
        return;
      }
    }

    setMessage({ type: 'success', text: 'Notification settings updated.' });
    reset(values);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Summary Reports</h2>
          <p className="text-sm text-text-secondary">
            Choose how often your managers receive summaries of routine activity across the
            organization.
          </p>
        </div>

        <Controller
          name="frequency"
          control={control}
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            >
              {FREQUENCY_OPTIONS.map((option) => {
                const isSelected = field.value === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer flex-col gap-1 rounded-xl border-[1.5px] border-border p-4 transition-colors',
                      isSelected && 'border-primary bg-primary/5',
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-[15px] font-semibold text-foreground">
                        {option.label}
                      </span>
                      <RadioGroupItem value={option.value} />
                    </span>
                    <span className="text-[13px] text-text-secondary">{option.description}</span>
                  </label>
                );
              })}
            </RadioGroup>
          )}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Notifications Categories</h2>
          <p className="text-sm text-text-secondary">Manage notification for your organization</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          <div className={cn(ROW_GRID_CLASS, 'border-b border-border')}>
            <span className="text-base font-semibold text-foreground">Notifications</span>
            <span className="text-center text-xs text-foreground sm:text-sm">Email</span>
            <span className="text-center text-xs text-foreground sm:text-sm">
              <span className="sm:hidden">In-app</span>
              <span className="hidden sm:inline">In-app notification</span>
            </span>
          </div>

          {NOTIFICATION_CATEGORY_META.map((meta) => {
            const isLocked = meta.key === ALWAYS_ON_NOTIFICATION_CATEGORY;
            return (
              <div
                key={meta.key}
                className={cn(ROW_GRID_CLASS, 'border-b border-border last:border-b-0')}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[15px] font-semibold text-foreground">{meta.label}</span>
                  <span className="text-sm text-text-secondary">{meta.description}</span>
                </div>

                {isLocked ? (
                  <>
                    <div className="flex justify-center">
                      <Checkbox
                        checked
                        disabled
                        aria-label={`${meta.label} email`}
                        className="size-5 rounded-[6px] data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground"
                      />
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        checked
                        disabled
                        aria-label={`${meta.label} in-app notification`}
                        className="size-5 rounded-[6px] data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-center">
                      <Controller
                        name={`categories.${meta.key}.emailEnabled`}
                        control={control}
                        render={({ field }) => (
                          <Checkbox
                            className="size-5 rounded-[6px]"
                            aria-label={`${meta.label} email`}
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                        )}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Controller
                        name={`categories.${meta.key}.inAppEnabled`}
                        control={control}
                        render={({ field }) => (
                          <Checkbox
                            className="size-5 rounded-[6px]"
                            aria-label={`${meta.label} in-app notification`}
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                        )}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {message && <Alert variant={message.type}>{message.text}</Alert>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          type="button"
          className="rounded-xl border-border font-semibold text-text-secondary"
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
  );
}
