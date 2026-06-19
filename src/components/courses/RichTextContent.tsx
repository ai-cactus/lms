import { sanitizeHtml } from '@/lib/sanitize';
import { containsHtml, isEmptyHtml } from '@/lib/html';
import { cn } from '@/lib/utils';

interface RichTextContentProps {
  html: string;
  className?: string;
}

// Prose styling for sanitized overview HTML. Uses arbitrary-variant utilities
// (same technique as AdminLessonEditor) so we don't depend on a typography plugin.
const PROSE_CLASSES = cn(
  'text-base leading-relaxed text-[#4a5568]',
  '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-[#1a202c]',
  '[&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[#1a202c]',
  '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#1a202c]',
  '[&_p]:mb-3',
  '[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6',
  '[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_li]:mb-1',
  '[&_a]:text-[#3182ce] [&_a]:underline',
  '[&_strong]:font-semibold',
);

export function RichTextContent({ html, className }: RichTextContentProps) {
  if (isEmptyHtml(html)) return null;

  // Legacy plain-text overviews: preserve line breaks, no HTML interpretation.
  if (!containsHtml(html)) {
    return (
      <p className={cn('whitespace-pre-line text-base leading-relaxed text-[#4a5568]', className)}>
        {html}
      </p>
    );
  }

  return (
    <div
      className={cn(PROSE_CLASSES, className)}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}
