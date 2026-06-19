/**
 * Returns true if the value is an HTML string containing at least one tag.
 * Used to distinguish rich-text overviews from legacy plain-text ones.
 */
export function containsHtml(value: string): boolean {
  if (!value) return false;
  return /<[a-z][\s\S]*>/i.test(value);
}

/**
 * Returns true if the (possibly HTML) value has no visible content.
 * Strips tags and &nbsp; so Quill's empty markup (`<p><br></p>`) counts as empty.
 */
export function isEmptyHtml(value: string | null | undefined): boolean {
  if (!value) return true;
  const text = value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return text.length === 0;
}
