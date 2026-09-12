/**
 * Shared field/typography classes for the Course Creation wizard steps, so every
 * step renders the same control chrome as the vetted Figma frames (56px controls,
 * 1.5px border, 12px radius, 18px body type).
 *
 * Colour comes from the app's own theme tokens (D11): the frames' palette is a
 * few hex digits away from `globals.css`, and matching the token is what keeps
 * the wizard consistent with every page outside the redesign.
 */

const wizardControlChrome =
  'h-[52px] w-full rounded-md border-[1.5px] border-border px-4 text-base text-foreground shadow-none data-[placeholder]:text-muted-foreground md:h-[56px] md:px-[18px] md:text-[18px]';

export const wizardControlClass = `${wizardControlChrome} bg-background`;

/**
 * Read-only mirror of a value derived on another step. The fill must be split
 * out of the chrome rather than appended to `wizardControlClass`: both would be
 * background utilities, so which one wins is stylesheet order, not class order.
 */
export const wizardReadonlyControlClass = `${wizardControlChrome} bg-background-secondary`;

export const wizardInputClass = `${wizardControlClass} outline-none transition-colors placeholder:text-muted-foreground focus:border-primary`;

export const wizardLabelClass =
  'text-sm font-medium tracking-[0.32px] text-text-secondary md:w-[400px] md:shrink-0 md:text-base';

export const wizardTitleClass =
  'text-center text-[26px] font-bold leading-[1.33] tracking-[-0.02em] text-foreground md:text-[36px]';

export const wizardSubtitleClass =
  'text-center text-[15px] font-medium leading-[1.44] text-text-secondary md:text-base';

/**
 * Figma pairs each label with its control on one 1080px row — a 400px label
 * column and the control filling the rest. Below `md` the pair stacks.
 */
export const wizardRowClass = 'flex w-full flex-col gap-2 md:flex-row md:items-center md:gap-0';

/** The hairline the frames draw between a step's field block and its next section. */
export const wizardDividerClass = 'w-full border-0 border-t border-t-border';

/**
 * The paired up/down chevrons the frames put inside a numeric field (Deadline,
 * Number of Questions, Attempts, reminder counts).
 */
export const wizardStepperButtonClass =
  'flex h-4 items-center justify-center text-text-secondary transition-colors hover:text-primary';

/**
 * Denser chrome for the card-based steps, whose fields sit inside a card rather
 * than in the full-width rows the other frames use: 44px controls, 10px radius,
 * 14px body type.
 */
export const wizardCardControlClass =
  'h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-sm text-foreground shadow-none data-[placeholder]:text-muted-foreground';

export const wizardCardInputClass = `${wizardCardControlClass} outline-none transition-colors placeholder:text-muted-foreground focus:border-primary`;

export const wizardCardLabelClass = 'text-sm font-semibold text-foreground';
