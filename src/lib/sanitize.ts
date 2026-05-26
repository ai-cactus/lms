import DOMPurify from 'isomorphic-dompurify';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'div',
    'span',
    'section',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'b',
    'i',
    'u',
    'a',
    'blockquote',
    'br',
    'hr',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: ['class', 'href', 'src', 'alt', 'target', 'rel'],
};

/**
 * Sanitizes HTML to prevent Cross-Site Scripting (XSS) attacks.
 * Uses isomorphic-dompurify which works on both server and client side.
 *
 * @param html The untrusted HTML string to sanitize
 * @returns A safe, sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
