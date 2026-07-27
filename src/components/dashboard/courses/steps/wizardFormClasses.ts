/**
 * Shared field/typography classes for the Course Creation wizard steps, so every
 * step renders the same control chrome as the Figma "COURSE CREATION" frames
 * (56px controls, 1.5px #e5e7ea border, 12px radius, 18px body type).
 */

export const wizardControlClass =
  'h-[52px] w-full rounded-[12px] border-[1.5px] border-[#e5e7ea] bg-white px-4 text-base text-[#0a0a0a] shadow-none data-[placeholder]:text-[#979797] md:h-[56px] md:px-[18px] md:text-[18px]';

export const wizardInputClass = `${wizardControlClass} outline-none transition-colors placeholder:text-[#979797] focus:border-primary`;

export const wizardLabelClass =
  'text-sm font-medium tracking-[0.32px] text-[#666d80] md:w-[400px] md:shrink-0 md:text-base';

export const wizardTitleClass =
  'text-center text-[26px] font-bold leading-[1.33] tracking-[-0.02em] text-[#383838] md:text-[36px]';

export const wizardSubtitleClass =
  'text-center text-[15px] font-medium leading-[1.44] text-[#424242] md:text-base';

export const wizardRowClass = 'flex w-full flex-col gap-2 md:flex-row md:items-center md:gap-0';
