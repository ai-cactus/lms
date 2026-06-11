'use client';

import * as React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  className?: string;
  children: React.ReactElement<{
    id?: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }>;
}

export function Field({ label, error, helperText, required, className, children }: FieldProps) {
  const generatedId = React.useId();
  const errorId = React.useId();
  const helperId = React.useId();

  const controlId = children.props.id ?? generatedId;
  const describedBy = error ? errorId : helperText ? helperId : undefined;

  const mergedDescribedBy =
    [describedBy, children.props['aria-describedby']].filter(Boolean).join(' ') || undefined;

  const control = React.cloneElement(children, {
    id: controlId,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-describedby': mergedDescribedBy,
  });

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={controlId}>
          {label}
          {required && (
            <span className="text-error" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      {control}
      {error ? (
        <p id={errorId} className="text-sm text-error">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-sm text-text-secondary">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
