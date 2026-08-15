/**
 * Shared helpers and chrome for the wizard's step-7 "Review Course Content"
 * screen. These are wizard-only: the learner player renders the same generated
 * content with its own components, which must stay untouched.
 */

export const REVIEW_STEP_TITLE = 'Review Course Content';

export const REVIEW_STEP_SUBTITLE =
  'Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.';

/** Average adult reading speed, used to derive the "N min read" meta line. */
const WORDS_PER_MINUTE = 200;

export interface ReviewHeading {
  id: string;
  text: string;
}

const HEADING_RE = /<(h[2-4])\b([^>]*)>([\s\S]*?)<\/\1>/gi;

/** Plain text of an HTML fragment, with the handful of entities we emit decoded. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function estimateReadMinutes(html: string): number {
  const words = htmlToPlainText(html).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Stamps a deterministic `id` on every h2–h4 so the Table of Content can anchor
 * to it, and returns the headings in document order.
 *
 * Must run AFTER `sanitizeHtml`, which strips `id` attributes — the ids added
 * here are generated, never taken from the model output.
 */
export function withHeadingAnchors(
  html: string,
  idPrefix: string,
): { html: string; headings: ReviewHeading[] } {
  if (!html) return { html: '', headings: [] };

  const headings: ReviewHeading[] = [];
  const anchored = html.replace(HEADING_RE, (_match, tag: string, attrs: string, inner: string) => {
    const id = `${idPrefix}-h${headings.length}`;
    headings.push({ id, text: htmlToPlainText(inner) });
    return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
  });

  return { html: anchored, headings };
}

export function formatReviewDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Typography for the generated article body. Lists are rendered as the design's
 * numbered circle callouts, which is how the pipeline's bolded key points read.
 */
export const reviewProseClass = [
  'text-[15px] leading-[1.7] text-[#424242]',
  '[&_p]:my-4',
  '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[#0d0d12] md:[&_h2]:text-[22px]',
  '[&_h3]:mt-7 [&_h3]:mb-3 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-[#0d0d12]',
  '[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-bold [&_h4]:text-[#0d0d12]',
  '[&_strong]:font-semibold [&_strong]:text-[#0d0d12]',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:my-5 [&_ul]:flex [&_ul]:list-none [&_ul]:flex-col [&_ul]:gap-4 [&_ul]:p-0 [&_ul]:[counter-reset:review-point]',
  '[&_ol]:my-5 [&_ol]:flex [&_ol]:list-none [&_ol]:flex-col [&_ol]:gap-4 [&_ol]:p-0 [&_ol]:[counter-reset:review-point]',
  '[&_li]:relative [&_li]:pl-9 [&_li]:[counter-increment:review-point]',
  '[&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-[3px] [&_li]:before:flex [&_li]:before:size-[22px] [&_li]:before:items-center [&_li]:before:justify-center [&_li]:before:rounded-full [&_li]:before:bg-[#eef1f6] [&_li]:before:text-[11px] [&_li]:before:font-semibold [&_li]:before:text-[#666d80] [&_li]:before:content-[counter(review-point)]',
].join(' ');
