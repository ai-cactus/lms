'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function PasswordInput({
  className,
  startIcon,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative w-full">
      {startIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground [&_svg]:size-5">
          {startIcon}
        </span>
      ) : null}
      <Input
        type={visible ? 'text' : 'password'}
        className={cn(startIcon && 'pl-11', 'pr-11', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? (
          <EyeOff className="size-5" aria-hidden="true" />
        ) : (
          <Eye className="size-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export { PasswordInput };
