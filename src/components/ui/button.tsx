import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Filled variants (default/secondary/destructive) turn a neutral grey when
  // `disabled` (e.g. a CTA whose form requirements aren't met yet) and snap back
  // to their colour while `loading` (aria-busy) so the spinner still reads as active.
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 disabled:bg-secondary disabled:text-text-tertiary disabled:shadow-none aria-busy:!bg-primary aria-busy:!text-primary-foreground',
        destructive:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 disabled:bg-secondary disabled:text-text-tertiary disabled:shadow-none aria-busy:!bg-destructive aria-busy:!text-white',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-accent disabled:text-text-tertiary disabled:shadow-none aria-busy:!text-secondary-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground disabled:opacity-50',
        link: 'text-primary underline-offset-4 hover:underline disabled:opacity-50',
      },
      size: {
        default: 'h-11 px-5 py-2 has-[>svg]:px-4',
        xs: "h-7 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-9 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-12 px-6 text-base has-[>svg]:px-5',
        icon: 'size-11',
        'icon-xs': "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-9',
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  const spinner =
    loading && !asChild ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : null;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {spinner}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
