/**
 * Tailwind translation of the rich-slide stylesheet, shared by the learner's
 * slide viewer and the admin's in-place editor so both render authored slide
 * markup identically.
 */
// Tailwind translation of the `.slideContent` rules from CoursePlayer.module.css,
// including the `:global(...)` rich-slide descendant selectors used by the
// dangerouslySetInnerHTML content. Kept as a single wrapper class so the injected
// HTML stays styled.
export const slideContentClass = [
  // base
  'flex-1 break-words text-[15px] font-normal leading-[1.7] text-text-secondary font-[var(--font-sans)]',
  '[hyphens:none] [word-break:normal] [white-space:normal]',
  // .slideContent *
  '[&_*]:[hyphens:none] [&_*]:[word-break:normal] [&_*]:break-words [&_*]:[text-wrap:pretty] [&_*]:text-left',
  // headings / lists / paragraphs / images
  '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-foreground [&_h3:first-child]:mt-0',
  '[&_ul]:pl-5 [&_ul]:my-2 [&_ul]:mb-4',
  '[&_ul_li]:text-sm [&_ul_li]:leading-[1.6] [&_ul_li]:mb-1 [&_ul_li]:text-text-secondary',
  '[&_p]:text-sm [&_p]:leading-[1.7] [&_p]:my-1.5',
  '[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-3',
  // .rich-slide
  '[&_.rich-slide]:mb-6 [&_.rich-slide]:pb-6 [&_.rich-slide]:border-b [&_.rich-slide]:border-[#e5e7eb]',
  '[&_.rich-slide:last-child]:border-b-0 [&_.rich-slide:last-child]:mb-0',
  // type badge
  '[&_.slide-type-badge]:inline-block [&_.slide-type-badge]:text-[10px] [&_.slide-type-badge]:font-bold [&_.slide-type-badge]:tracking-[0.08em] [&_.slide-type-badge]:uppercase [&_.slide-type-badge]:px-2.5 [&_.slide-type-badge]:py-[3px] [&_.slide-type-badge]:rounded [&_.slide-type-badge]:mb-2.5 [&_.slide-type-badge]:leading-none',
  '[&_.slide-type-badge-tell]:bg-[#eef2ff] [&_.slide-type-badge-tell]:text-[#4338ca]',
  '[&_.slide-type-badge-show]:bg-[#fffbeb] [&_.slide-type-badge-show]:text-[#92400e]',
  '[&_.slide-type-badge-do]:bg-[#ecfdf5] [&_.slide-type-badge-do]:text-[#065f46]',
  // heading
  '[&_.slide-heading]:text-[17px] [&_.slide-heading]:font-extrabold [&_.slide-heading]:text-foreground [&_.slide-heading]:m-0 [&_.slide-heading]:mb-3.5 [&_.slide-heading]:leading-[1.3]',
  '[&_.slide-type-tell_.slide-heading]:border-l-[3px] [&_.slide-type-tell_.slide-heading]:border-[#6366f1] [&_.slide-type-tell_.slide-heading]:pl-3',
  '[&_.slide-type-show_.slide-heading]:border-l-[3px] [&_.slide-type-show_.slide-heading]:border-[#f59e0b] [&_.slide-type-show_.slide-heading]:pl-3',
  '[&_.slide-type-do_.slide-heading]:border-l-[3px] [&_.slide-type-do_.slide-heading]:border-[#10b981] [&_.slide-type-do_.slide-heading]:pl-3',
  // core concept
  '[&_.slide-core-concept]:bg-[linear-gradient(135deg,#f8fafc_0%,#f1f5f9_100%)] [&_.slide-core-concept]:border-l-[3px] [&_.slide-core-concept]:border-primary [&_.slide-core-concept]:px-[18px] [&_.slide-core-concept]:py-3.5 [&_.slide-core-concept]:mb-4 [&_.slide-core-concept]:rounded-[0_8px_8px_0]',
  '[&_.slide-core-concept_p]:text-sm [&_.slide-core-concept_p]:leading-[1.7] [&_.slide-core-concept_p]:m-0 [&_.slide-core-concept_p]:text-foreground',
  // key points
  '[&_.slide-key-points]:pl-5 [&_.slide-key-points]:my-2 [&_.slide-key-points]:mb-4',
  '[&_.slide-key-points_li]:text-sm [&_.slide-key-points_li]:leading-[1.6] [&_.slide-key-points_li]:mb-1.5 [&_.slide-key-points_li]:text-text-secondary [&_.slide-key-points_li]:relative',
  '[&_.slide-key-points_li::marker]:text-primary',
  // box titles
  '[&_.slide-box-title]:text-[11px] [&_.slide-box-title]:font-bold [&_.slide-box-title]:uppercase [&_.slide-box-title]:tracking-[0.08em] [&_.slide-box-title]:m-0 [&_.slide-box-title]:mb-2',
  // terms box
  '[&_.slide-terms-box]:bg-[#f0fdf4] [&_.slide-terms-box]:border [&_.slide-terms-box]:border-[#bbf7d0] [&_.slide-terms-box]:rounded-lg [&_.slide-terms-box]:px-4 [&_.slide-terms-box]:py-3 [&_.slide-terms-box]:my-3',
  '[&_.slide-terms-box_.slide-box-title]:text-[#166534]',
  '[&_.slide-term-item]:text-[13px] [&_.slide-term-item]:mb-1.5 [&_.slide-term-item]:leading-[1.5] [&_.slide-term-item]:text-text-secondary',
  '[&_.slide-term-item_strong]:text-[#166534] [&_.slide-term-item_strong]:font-semibold',
  // details box
  '[&_.slide-details-box]:bg-[#fefce8] [&_.slide-details-box]:border [&_.slide-details-box]:border-[#fde68a] [&_.slide-details-box]:rounded-lg [&_.slide-details-box]:px-4 [&_.slide-details-box]:py-3 [&_.slide-details-box]:my-3',
  '[&_.slide-details-box_.slide-box-title]:text-[#854d0e]',
  '[&_.slide-details-box_ul]:pl-[18px] [&_.slide-details-box_ul]:mt-1 [&_.slide-details-box_ul]:mb-0',
  '[&_.slide-details-box_li]:text-[13px] [&_.slide-details-box_li]:leading-[1.5] [&_.slide-details-box_li]:mb-1 [&_.slide-details-box_li]:text-text-secondary',
  // scenario block
  '[&_.slide-scenario]:bg-[#fffbeb] [&_.slide-scenario]:border [&_.slide-scenario]:border-[#fbbf24] [&_.slide-scenario]:rounded-[10px] [&_.slide-scenario]:px-5 [&_.slide-scenario]:py-4 [&_.slide-scenario]:my-3',
  '[&_.scenario-label]:text-[11px] [&_.scenario-label]:font-bold [&_.scenario-label]:uppercase [&_.scenario-label]:tracking-[0.08em] [&_.scenario-label]:text-[#92400e] [&_.scenario-label]:mb-2.5',
  '[&_.scenario-tag]:inline-block [&_.scenario-tag]:text-[10px] [&_.scenario-tag]:font-bold [&_.scenario-tag]:uppercase [&_.scenario-tag]:tracking-[0.05em] [&_.scenario-tag]:px-1.5 [&_.scenario-tag]:py-0.5 [&_.scenario-tag]:rounded-[3px] [&_.scenario-tag]:mr-1.5 [&_.scenario-tag]:align-baseline',
  '[&_.scenario-situation]:text-sm [&_.scenario-situation]:mb-3 [&_.scenario-situation]:text-[#78350f] [&_.scenario-situation]:leading-[1.6]',
  '[&_.scenario-situation_.scenario-tag]:bg-[#fef3c7] [&_.scenario-situation_.scenario-tag]:text-[#92400e]',
  '[&_.scenario-correct]:bg-[#ecfdf5] [&_.scenario-correct]:rounded-md [&_.scenario-correct]:px-3.5 [&_.scenario-correct]:py-2.5 [&_.scenario-correct]:mb-2 [&_.scenario-correct]:text-[13px] [&_.scenario-correct]:text-[#065f46] [&_.scenario-correct]:leading-[1.5]',
  '[&_.scenario-correct_.scenario-tag]:bg-[#bbf7d0] [&_.scenario-correct_.scenario-tag]:text-[#166534]',
  '[&_.scenario-wrong]:bg-[#fef2f2] [&_.scenario-wrong]:rounded-md [&_.scenario-wrong]:px-3.5 [&_.scenario-wrong]:py-2.5 [&_.scenario-wrong]:mb-2 [&_.scenario-wrong]:text-[13px] [&_.scenario-wrong]:text-[#991b1b] [&_.scenario-wrong]:leading-[1.5]',
  '[&_.scenario-wrong_.scenario-tag]:bg-[#fecaca] [&_.scenario-wrong_.scenario-tag]:text-[#991b1b]',
  '[&_.scenario-rationale]:text-[13px] [&_.scenario-rationale]:text-[#6b7280] [&_.scenario-rationale]:italic [&_.scenario-rationale]:leading-[1.5] [&_.scenario-rationale]:mt-2',
  '[&_.scenario-rationale_.scenario-tag]:bg-[#f3f4f6] [&_.scenario-rationale_.scenario-tag]:text-[#6b7280] [&_.scenario-rationale_.scenario-tag]:not-italic',
  // action steps
  '[&_.slide-action-steps]:[counter-reset:action-step] [&_.slide-action-steps]:list-none [&_.slide-action-steps]:p-0 [&_.slide-action-steps]:my-3',
  '[&_.slide-action-steps_li]:[counter-increment:action-step] [&_.slide-action-steps_li]:flex [&_.slide-action-steps_li]:items-start [&_.slide-action-steps_li]:gap-3 [&_.slide-action-steps_li]:py-2.5 [&_.slide-action-steps_li]:border-b [&_.slide-action-steps_li]:border-[#f3f4f6] [&_.slide-action-steps_li]:text-sm [&_.slide-action-steps_li]:leading-[1.5] [&_.slide-action-steps_li]:text-foreground',
  '[&_.slide-action-steps_li:last-child]:border-b-0',
  '[&_.slide-action-steps_li::before]:[content:counter(action-step)] [&_.slide-action-steps_li::before]:flex [&_.slide-action-steps_li::before]:items-center [&_.slide-action-steps_li::before]:justify-center [&_.slide-action-steps_li::before]:min-w-[28px] [&_.slide-action-steps_li::before]:h-7 [&_.slide-action-steps_li::before]:rounded-full [&_.slide-action-steps_li::before]:bg-[#10b981] [&_.slide-action-steps_li::before]:text-white [&_.slide-action-steps_li::before]:text-[13px] [&_.slide-action-steps_li::before]:font-bold [&_.slide-action-steps_li::before]:shrink-0',
  // process flow
  '[&_.slide-process-flow]:flex [&_.slide-process-flow]:flex-col [&_.slide-process-flow]:gap-0 [&_.slide-process-flow]:my-3',
  '[&_.process-step]:grid [&_.process-step]:grid-cols-[50px_1fr] md:[&_.process-step]:grid-cols-[70px_1fr_1fr] [&_.process-step]:gap-2 [&_.process-step]:py-2.5 [&_.process-step]:border-b [&_.process-step]:border-[#f3f4f6] [&_.process-step]:text-[13px] [&_.process-step]:items-start',
  '[&_.process-step:last-child]:border-b-0',
  '[&_.step-number]:font-bold [&_.step-number]:text-[#10b981] [&_.step-number]:text-xs [&_.step-number]:uppercase',
  '[&_.step-action]:font-semibold [&_.step-action]:text-foreground [&_.step-action]:leading-[1.4]',
  '[&_.step-why]:text-[#6b7280] [&_.step-why]:leading-[1.4] [&_.step-why]:[grid-column:1/-1] [&_.step-why]:pl-[50px] md:[&_.step-why]:[grid-column:auto] md:[&_.step-why]:pl-0',
  // checklist
  '[&_.slide-checklist]:list-none [&_.slide-checklist]:p-0 [&_.slide-checklist]:my-2',
  '[&_.slide-checklist_li]:text-sm [&_.slide-checklist_li]:leading-[1.6] [&_.slide-checklist_li]:mb-1.5 [&_.slide-checklist_li]:pl-7 [&_.slide-checklist_li]:relative [&_.slide-checklist_li]:text-text-secondary',
  "[&_.slide-checklist_li::before]:[content:'\\2610'] [&_.slide-checklist_li::before]:absolute [&_.slide-checklist_li::before]:left-0 [&_.slide-checklist_li::before]:text-[#10b981] [&_.slide-checklist_li::before]:text-base [&_.slide-checklist_li::before]:leading-[1.5]",
].join(' ');

/**
 * The learner's variant. `splitSlideContent` lifts each page's heading out of
 * the body and renders it separately, so a leading heading left in the body is
 * a duplicate and is hidden. The in-place editor must NOT use this: there the
 * heading element is part of the editable section and has to stay visible to be
 * typed into.
 */
export const learnerSlideContentClass = `${slideContentClass} [&>h1:first-child]:hidden [&>h2:first-child]:hidden`;
