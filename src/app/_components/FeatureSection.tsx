'use client';

import React from 'react';
import { ShieldCheck, Clock, UserCheck, Upload, CheckCircle2 } from 'lucide-react';

const cardClass =
  'flex flex-col rounded-2xl bg-[#f6f6f5] px-6 py-8 transition-all duration-200 hover:-translate-y-1 hover:shadow-md';
const iconClass = 'size-8 text-foreground';
const dividerClass = 'mb-6 h-px w-full bg-[#e5e5e5]';
const cardTitleClass = 'mb-4 text-xl font-semibold leading-tight text-[#0b1a38]';
const cardDescClass = 'text-sm leading-relaxed text-[#6b7280]';

export default function FeatureSection() {
  return (
    <section
      className="flex flex-col items-center bg-background px-4 py-12 sm:px-6 lg:py-20"
      id="features"
    >
      <div className="mb-10 max-w-[800px] text-center sm:mb-16">
        <h2 className="mb-4 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[32px] lg:text-5xl">
          Built for behavioral health
          <br />
          compliance workflows.
        </h2>
        <p className="text-base text-text-secondary sm:text-lg">
          Feel confident knowing your practice is fully ready for CARF and state inspections.
        </p>
      </div>

      <div className="mb-12 grid w-full max-w-[1200px] grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Feature 1 */}
        <div className={cardClass}>
          <div className="mb-6 flex items-start">
            <ShieldCheck className={iconClass} strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div className={dividerClass} />
          <h3 className={cardTitleClass}>
            Policy-Linked
            <br />
            Training
            <br />
            Documentation
          </h3>
          <p className={cardDescClass}>
            Builds every training module directly from your clinic&apos;s own policies with a
            permanent link to the source.
          </p>
        </div>

        {/* Feature 2 */}
        <div className={cardClass}>
          <div className="mb-6 flex items-start">
            <Clock className={iconClass} strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div className={dividerClass} />
          <h3 className={cardTitleClass}>
            Timestamped
            <br />
            Completion Records
          </h3>
          <p className={cardDescClass}>
            Logs every completion with exact date, time, and staff name for instant surveyor
            verification.
          </p>
        </div>

        {/* Feature 3 */}
        <div className={cardClass}>
          <div className="mb-6 flex items-start">
            <UserCheck className={iconClass} strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div className={dividerClass} />
          <h3 className={cardTitleClass}>
            Role-Based Staff
            <br />
            Assignments
          </h3>
          <p className={cardDescClass}>
            Assign trainings by role, department, or individual in one click with no spreadsheets or
            chasing.
          </p>
        </div>

        {/* Feature 4 */}
        <div className={cardClass}>
          <div className="mb-6 flex items-start">
            <Upload className={iconClass} strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div className={dividerClass} />
          <h3 className={cardTitleClass}>
            Exportable
            <br />
            Inspection
            <br />
            Documentation
          </h3>
          <p className={cardDescClass}>
            Generate a full auditor-ready report in seconds with policies, timestamps, and results,
            downloadable instantly.
          </p>
        </div>
      </div>

      {/* CARF Pill Badge */}
      <div className="inline-flex items-center gap-3 rounded-full border border-border bg-background px-4 py-2.5 text-center text-[13px] font-semibold text-foreground shadow-sm sm:px-6 sm:text-sm">
        <CheckCircle2 className="size-5 shrink-0 text-foreground" aria-hidden="true" />
        Preparing facilities for CARF and state inspections.
      </div>
    </section>
  );
}
