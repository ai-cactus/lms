import React from 'react';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1000px]">
      {/* Header Skeleton */}
      <div className="mb-6">
        <div className="h-7 w-[180px] animate-pulse rounded-md bg-[#cbd5e0]" />
      </div>

      {/* Content Skeleton */}
      <div className="flex flex-col gap-10 rounded-[20px] bg-white p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] sm:p-10 lg:px-[100px] lg:py-[50px]">
        {/* Tabs Skeleton */}
        <div className="h-12 w-full max-w-[340px] animate-pulse rounded-[10px] bg-background-secondary" />

        {/* Avatar Skeleton */}
        <div className="mb-2.5 flex items-center gap-6">
          <div className="size-24 animate-pulse rounded-full bg-[#cbd5e0]" />
          <div className="mt-[60px] -ml-5 size-8 rounded-full border-[3px] border-white bg-[#a0aec0]" />
        </div>

        {/* Form Fields Skeletons */}
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="h-5 w-[140px] animate-pulse rounded-md bg-[#cbd5e0]" />
            <div className="h-14 w-full animate-pulse rounded-[10px] border-2 border-border bg-background-secondary" />
          </div>
          <div className="flex flex-col gap-4">
            <div className="h-5 w-[140px] animate-pulse rounded-md bg-[#cbd5e0]" />
            <div className="h-14 w-full animate-pulse rounded-[10px] border-2 border-border bg-background-secondary" />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="h-5 w-[140px] animate-pulse rounded-md bg-[#cbd5e0]" />
          <div className="h-14 w-full animate-pulse rounded-[10px] border-2 border-border bg-background-secondary" />
        </div>

        <div className="flex flex-col gap-4">
          <div className="h-5 w-[140px] animate-pulse rounded-md bg-[#cbd5e0]" />
          <div className="h-14 w-full animate-pulse rounded-[10px] border-2 border-border bg-background-secondary" />
        </div>

        <div className="flex flex-col gap-4">
          <div className="h-5 w-[140px] animate-pulse rounded-md bg-[#cbd5e0]" />
          <div className="h-14 w-full animate-pulse rounded-[10px] border-2 border-border bg-background-secondary" />
        </div>

        {/* Buttons Skeleton */}
        <div className="mt-5 flex justify-end gap-4">
          <div className="h-10 w-[100px] animate-pulse rounded-[10px] bg-background-secondary" />
          <div className="h-10 w-[140px] animate-pulse rounded-[10px] bg-background-secondary" />
        </div>
      </div>
    </div>
  );
}
