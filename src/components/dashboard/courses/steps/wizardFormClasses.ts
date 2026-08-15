/**
 * Shared field/typography classes for the Course Creation wizard steps, so every
 * step renders the same control chrome as the Figma "COURSE CREATION" frames
 * (56px controls, 1.5px #e5e7ea border, 12px radius, 18px body type).
 */

const wizardControlChrome =
  'h-[52px] w-full rounded-[12px] border-[1.5px] border-[#e5e7ea] px-4 text-base text-[#0a0a0a] shadow-none data-[placeholder]:text-[#979797] md:h-[56px] md:px-[18px] md:text-[18px]';

export const wizardControlClass = `${wizardControlChrome} bg-white`;

/**
 * Read-only mirror of a value derived on another step. The fill must be split
 * out of the chrome rather than appended to `wizardControlClass`: both would be
 * background utilities, so which one wins is stylesheet order, not class order.
 */
export const wizardReadonlyControlClass = `${wizardControlChrome} bg-bg-secondary`;

export const wizardInputClass = `${wizardControlClass} outline-none transition-colors placeholder:text-[#979797] focus:border-primary`;

export const wizardLabelClass =
  'text-sm font-medium tracking-[0.32px] text-[#666d80] md:w-[400px] md:shrink-0 md:text-base';

export const wizardTitleClass =
  'text-center text-[26px] font-bold leading-[1.33] tracking-[-0.02em] text-[#383838] md:text-[36px]';

export const wizardSubtitleClass =
  'text-center text-[15px] font-medium leading-[1.44] text-[#424242] md:text-base';

export const wizardRowClass = 'flex w-full flex-col gap-2 md:flex-row md:items-center md:gap-0';

/**
 * Denser chrome for the card-based steps (Figma "Create Course Modules"), whose
 * fields sit two-up inside a 720px card rather than in the full-width rows the
 * earlier frames use: 44px controls, 10px radius, 14px body type.
 */
export const wizardCardControlClass =
  'h-11 w-full rounded-[10px] border border-[#e5e7ea] bg-white px-3.5 text-sm text-[#0a0a0a] shadow-none data-[placeholder]:text-[#979797]';

export const wizardCardInputClass = `${wizardCardControlClass} outline-none transition-colors placeholder:text-[#979797] focus:border-primary`;

export const wizardCardLabelClass = 'text-sm font-semibold text-[#0d0d12]';
