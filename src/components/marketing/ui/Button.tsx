import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'brand' | 'dark' | 'white' | 'soft';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonShape = 'rounded' | 'pill';

const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

const base =
  'relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-[filter,background-color,color] disabled:pointer-events-none disabled:opacity-60';

const variantStyles: Record<ButtonVariant, string> = {
  // Nav "Request a Demo" — brand blue with inner highlight + soft drop shadow
  brand:
    'border border-black/[0.08] bg-brand text-on-brand shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05),0px_1px_0px_0px_rgba(0,0,0,0.06),inset_0px_4px_6px_0px_rgba(255,255,255,0.15)] hover:brightness-110',
  // Hero "Start for free" — near-black solid
  dark: 'bg-[#1c1917] text-white hover:bg-[#2a2623]',
  // Nav "Sign in" — white with hairline ring shadow
  white:
    'bg-white text-ink shadow-[0px_4px_6px_-6px_rgba(15,12,12,0.01),0px_0px_0px_1px_rgba(16,12,12,0.08),0px_0.361px_0.217px_-1.25px_rgba(0,0,0,0.07),0px_1.373px_0.824px_-2.5px_rgba(0,0,0,0.06),0px_6px_3.6px_-3.75px_rgba(0,0,0,0.03)] hover:bg-zinc-50',
  // Hero "Request Demo" — translucent neutral
  soft: 'bg-black/[0.04] text-ink hover:bg-black/[0.07]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-4 pb-2 pt-[7px] text-[14px] leading-[17px] tracking-[0.28px]',
  md: 'px-5 py-2.5 text-[15px] leading-tight',
  lg: 'px-6 py-3 text-[16px] tracking-[-0.4px] sm:px-7 sm:py-3.5 sm:text-[18px] sm:tracking-[-0.59px]',
};

const shapeStyles: Record<ButtonShape, string> = {
  rounded: 'rounded-lg',
  pill: 'rounded-full',
};

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
};

type AnchorProps = CommonProps & {
  href: string;
} & Omit<ComponentPropsWithoutRef<typeof Link>, 'href' | 'className' | 'children'>;

type NativeButtonProps = CommonProps & {
  href?: undefined;
} & Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'>;

export type ButtonProps = AnchorProps | NativeButtonProps;

export function Button(props: ButtonProps) {
  const {
    variant = 'brand',
    size = 'sm',
    shape = 'rounded',
    leadingIcon,
    trailingIcon,
    fullWidth,
    className,
    children,
    ...rest
  } = props;

  const classes = cn(
    base,
    variantStyles[variant],
    sizeStyles[size],
    shapeStyles[shape],
    fullWidth && 'w-full',
    focusRing,
    className,
  );

  const inner = (
    <>
      {leadingIcon}
      <span>{children}</span>
      {trailingIcon}
    </>
  );

  if ('href' in props && props.href !== undefined) {
    const { href, ...anchorRest } = rest as AnchorProps;
    return (
      <Link href={href} className={classes} {...anchorRest}>
        {inner}
      </Link>
    );
  }

  return (
    <button className={classes} {...(rest as NativeButtonProps)}>
      {inner}
    </button>
  );
}
