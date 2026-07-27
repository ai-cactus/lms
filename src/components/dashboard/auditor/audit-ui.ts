/**
 * Shared presentation tokens for the Audit Reports tabs.
 *
 * The AUDIT REPORTS Figma sections use their own card/table kit (12px radius,
 * `#e2e8f0` borders, uppercase 12px table heads) rather than the 17px/`#dfe1e6`
 * kit used by the Documents and Courses pages, so these constants are scoped to
 * this folder instead of being promoted to a global primitive.
 */

export const auditCard =
  'overflow-hidden rounded-[12px] border border-[#e2e8f0] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]';

export const auditCardHeader =
  'flex flex-col gap-3 border-b border-[#f1f5f9] px-4 pb-5 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pb-[25px] sm:pt-6';

export const auditCardTitle = 'text-[18px] font-bold leading-7 text-[#0f172a]';

export const auditHeaderGroup = '[&_tr]:border-b-0';

export const auditHead =
  'h-12 bg-[#f8fafc] px-4 py-4 text-[12px] font-bold uppercase leading-4 tracking-[0.6px] text-[#64748b] sm:px-6';

export const auditRow = 'border-b border-solid border-[#f1f5f9] hover:bg-[#f8fafc]';

export const auditCell =
  'h-[71px] px-4 py-4 text-[14px] font-normal leading-5 text-[#0f172a] sm:px-6';

export const auditSearchWrap = 'w-full sm:w-[300px]';

export const auditSearch =
  'h-10 w-full rounded-[8px] border-0 bg-[#f8fafc] pl-9 text-[14px] shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] placeholder:text-[#6b7280]';

export const auditOutlineButton =
  'h-[38px] gap-2 rounded-[8px] border-[#e2e8f0] px-[13px] text-[14px] font-medium text-[#0f172a]';

export const auditRowAction = 'text-[14px] font-semibold text-primary hover:underline';
