import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { RichTextContent } from './RichTextContent';

describe('RichTextContent', () => {
  test('renders HTML headings and lists as real elements', () => {
    const { container } = render(
      <RichTextContent html="<h2>About</h2><ul><li>Item one</li></ul>" />,
    );
    expect(container.querySelector('h2')).toHaveTextContent('About');
    expect(container.querySelector('ul li')).toHaveTextContent('Item one');
  });

  test('strips dangerous markup via sanitizeHtml', () => {
    const { container } = render(<RichTextContent html="<p>ok</p><script>alert(1)</script>" />);
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('ok');
  });

  test('renders legacy plain text with preserved line breaks', () => {
    render(<RichTextContent html={'About\nCourse Overview'} />);
    const el = screen.getByText(/About/);
    expect(el.className).toMatch(/whitespace-pre-line/);
  });

  test('renders nothing for empty input', () => {
    const { container } = render(<RichTextContent html="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
