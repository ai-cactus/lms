import React from 'react';

interface Props {
  title: string;
  subtitle: string;
  /** Optional right-aligned action (e.g. "Add Payment Method"). */
  action?: React.ReactNode;
}

export default function BillingPageHeader({ title, subtitle, action }: Props) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-[5px]">
        <h1 className="text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
          {title}
        </h1>
        <p className="text-[14px] leading-normal font-medium text-[#a0aec0]">{subtitle}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
