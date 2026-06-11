import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm',
  {
    variants: {
      variant: {
        info: 'border-border bg-background-secondary text-foreground [&_svg]:text-text-secondary',
        success: 'border-success/30 bg-success/10 text-foreground [&_svg]:text-success',
        warning: 'border-warning/30 bg-warning/10 text-foreground [&_svg]:text-warning',
        error: 'border-error/30 bg-error/10 text-foreground [&_svg]:text-error',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

const ICONS: Record<NonNullable<VariantProps<typeof alertVariants>['variant']>, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  title?: string;
}

function Alert({ variant = 'info', title, children, className, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? 'info'];
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-semibold leading-tight">{title}</p>}
        {children && <div className="text-sm text-text-secondary">{children}</div>}
      </div>
    </div>
  );
}

export { Alert, alertVariants };
