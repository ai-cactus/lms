'use client';

import React from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { enterLearnMode } from '@/app/actions/session-bridge';

const containerCls = 'flex w-full rounded-[12px] bg-[#f3f4f6] p-1';
const segmentBase =
  'flex-1 rounded-[8px] px-4 py-2 text-center text-[13px] font-semibold transition-colors';
const segmentActive = 'bg-white text-[#101928] shadow-sm';
const segmentInactive = 'text-[#667085]';

function LearnSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={false}
      className={`${segmentBase} ${segmentInactive} ${pending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      Learn
    </button>
  );
}

interface SidebarModeSwitcherProps {
  mode: 'manage' | 'learn';
}

export default function SidebarModeSwitcher({ mode }: SidebarModeSwitcherProps) {
  return (
    <div role="group" aria-label="View mode" className={containerCls}>
      {mode === 'manage' ? (
        <>
          <span aria-pressed className={`${segmentBase} ${segmentActive}`}>
            Manage
          </span>
          <form action={enterLearnMode} className="flex flex-1">
            <LearnSubmitButton />
          </form>
        </>
      ) : (
        <>
          <Link
            href="/dashboard"
            aria-pressed={false}
            className={`${segmentBase} ${segmentInactive}`}
          >
            Manage
          </Link>
          <span aria-pressed className={`${segmentBase} ${segmentActive}`}>
            Learn
          </span>
        </>
      )}
    </div>
  );
}
