import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitizes HTML to prevent Cross-Site Scripting (XSS) attacks.
 * Uses isomorphic-dompurify which works on both server and client side.
 *
 * @param html The untrusted HTML string to sanitize
 * @returns A safe, sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html);
}
