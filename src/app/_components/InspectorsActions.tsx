import React from 'react';
import Link from 'next/link';

export default function InspectorsActions() {
  return (
    <div className="mt-12 flex w-full flex-col items-center justify-center gap-4 sm:w-auto sm:flex-row md:mt-16">
      <Link
        href="/signup"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-8 py-4 text-base font-semibold text-background shadow-[0_4px_14px_0_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] sm:w-auto"
      >
        Start for free &rarr;
      </Link>
      <Link
        href="/request-demo"
        className="inline-flex w-full items-center justify-center rounded-full bg-secondary px-8 py-4 text-base font-semibold text-foreground transition-all hover:bg-border sm:w-auto"
      >
        Request Demo
      </Link>
    </div>
  );
}
