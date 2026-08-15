/**
 * Shared class strings for the /dashboard/profile panels.
 *
 * The Figma profile screens use a larger label/button scale than the app-wide
 * `Field`/`Button` defaults, so the overrides live here once instead of being
 * duplicated across the panel components.
 */

/** `Field` wrapper: Figma label scale (16.584/22.111, semibold) + label→control gap. */
export const fieldClass =
  'gap-[16.584px] [&>label]:text-[16.584px] [&>label]:leading-[22.111px] [&>label]:font-semibold [&>label]:tracking-[0.332px] [&>label]:text-foreground';

/** Discard / Save Changes footer buttons. */
export const actionButtonClass =
  'h-14 rounded-xl px-8 text-lg leading-6 font-semibold tracking-[0.36px]';

/** Numbered section banner used by the My Organization editor. */
export const sectionHeadingClass =
  'rounded-[8px] bg-[#f6f8fc] px-[22px] py-[18px] text-[16.584px] leading-[22.111px] font-semibold text-foreground';
