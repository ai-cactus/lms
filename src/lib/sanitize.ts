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
 * The in-place slide editor's variant. Identical to the reader's config except
 * for the attributes the editor itself injects around each editable region
 * (`data-*` and `aria-*` already survive DOMPurify's defaults).
 *
 * Kept as a separate config rather than widening `SANITIZE_CONFIG`: nothing on
 * the learner path should be able to ship a `contenteditable` element.
 */
const EDITABLE_SANITIZE_CONFIG = {
  ALLOWED_TAGS: SANITIZE_CONFIG.ALLOWED_TAGS,
  ALLOWED_ATTR: [...SANITIZE_CONFIG.ALLOWED_ATTR, 'contenteditable', 'role', 'spellcheck'],
};

// Harden links that open in a new tab against tabnapping: any anchor with
// target="_blank" must carry rel="noopener noreferrer" so the opened page
// cannot reach back through window.opener.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

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

/**
 * Sanitizes slide HTML that carries the in-place editor's own editing
 * attributes. Use only for the admin editing surface — `sanitizeHtml` remains
 * the sink for everything a learner sees.
 *
 * @param html The HTML produced by `buildEditableSlideHtml`
 * @returns A safe, sanitized HTML string with the editing attributes intact
 */
export function sanitizeEditableHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, EDITABLE_SANITIZE_CONFIG);
}
