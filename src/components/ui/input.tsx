import * as React from 'react';

import { cn } from '@/lib/utils';

const inputBaseClassName =
  'h-14 w-full min-w-0 rounded-[10px] border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-secondary dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';

function Input({
  className,
  type,
  startIcon,
  ...props
}: React.ComponentProps<'input'> & { startIcon?: React.ReactNode }) {
  if (startIcon) {
    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground [&_svg]:size-5">
          {startIcon}
        </span>
        <input
          type={type}
          data-slot="input"
          className={cn(inputBaseClassName, 'pl-11', className)}
          {...props}
        />
      </div>
    );
  }

  return (
    <input type={type} data-slot="input" className={cn(inputBaseClassName, className)} {...props} />
  );
}

export { Input, inputBaseClassName };
