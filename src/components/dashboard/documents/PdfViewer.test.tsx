/**
 * Tests for the full-screen PDF viewer's design-approved shape:
 * a left thumbnail rail + a single stacked, scrollable page column.
 *
 * The zoom controls and the "Page N of N" pager were removed on purpose — page
 * navigation now happens through the rail and by scrolling — so the absence of
 * that toolbar is asserted here as a regression guard.
 *
 * `react-pdf` needs a pdf.js worker and a canvas that jsdom cannot provide, so
 * it is stubbed: the stub reports a fixed page count and renders the props this
 * component is responsible for (page number, render width, thumbnail clicks).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PAGE_COUNT = 3;
const CONTAINER_WIDTH = 800;

vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({
    children,
    className,
    onLoadSuccess,
  }: {
    children: ReactNode;
    className?: string;
    onLoadSuccess?: (args: { numPages: number }) => void;
  }) => {
    // The real Document reports the page count once, when the file finishes
    // loading — not on every re-render.
    const loaded = useRef(false);
    useEffect(() => {
      if (loaded.current) return;
      loaded.current = true;
      onLoadSuccess?.({ numPages: PAGE_COUNT });
    }, [onLoadSuccess]);
    return <div className={className}>{children}</div>;
  },
  Page: ({ pageNumber, width }: { pageNumber: number; width: number }) => (
    <div data-testid="pdf-page" data-width={width}>
      Rendered page {pageNumber}
    </div>
  ),
  Thumbnail: ({
    pageNumber,
    width,
    onItemClick,
  }: {
    pageNumber: number;
    width: number;
    onItemClick?: (args: { pageIndex: number; pageNumber: number }) => void;
  }) => (
    <button
      type="button"
      data-width={width}
      onClick={() => onItemClick?.({ pageIndex: pageNumber - 1, pageNumber })}
    >
      Thumbnail {pageNumber}
    </button>
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

import PdfViewer from './PdfViewer';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  // jsdom has no layout — the viewer sizes pages from the measured container.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: CONTAINER_WIDTH,
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PdfViewer', () => {
  it('renders every page stacked at the measured container width', () => {
    render(<PdfViewer fileUrl="/api/documents/v1/preview" />);

    const pages = screen.getAllByTestId('pdf-page');
    expect(pages).toHaveLength(PAGE_COUNT);
    expect(pages.map((page) => page.textContent)).toEqual([
      'Rendered page 1',
      'Rendered page 2',
      'Rendered page 3',
    ]);
    for (const page of pages) {
      expect(page).toHaveAttribute('data-width', String(CONTAINER_WIDTH));
    }
  });

  it('lists one thumbnail per page in the navigation rail', () => {
    render(<PdfViewer fileUrl="/api/documents/v1/preview" />);

    const rail = screen.getByRole('navigation', { name: 'Document pages' });
    expect(within(rail).getAllByRole('button')).toHaveLength(PAGE_COUNT);
    expect(within(rail).getByRole('button', { name: 'Thumbnail 1' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Thumbnail 3' })).toBeInTheDocument();
  });

  it('highlights the first page and moves the highlight to a clicked thumbnail', async () => {
    const user = userEvent.setup();
    const { container } = render(<PdfViewer fileUrl="/api/documents/v1/preview" />);

    const activeThumbnail = () => container.querySelectorAll('[aria-current="page"]');
    expect(activeThumbnail()).toHaveLength(1);
    expect(activeThumbnail()[0]).toHaveTextContent('Thumbnail 1');

    await user.click(screen.getByRole('button', { name: 'Thumbnail 2' }));

    expect(activeThumbnail()).toHaveLength(1);
    expect(activeThumbnail()[0]).toHaveTextContent('Thumbnail 2');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('renders the meta slot alongside the document', () => {
    render(<PdfViewer fileUrl="/api/documents/v1/preview" meta={<div>Uploaded 4 mins ago</div>} />);

    expect(screen.getByText('Uploaded 4 mins ago')).toBeInTheDocument();
  });

  it('offers no zoom controls and no page pager', () => {
    render(<PdfViewer fileUrl="/api/documents/v1/preview" />);

    expect(screen.queryByRole('button', { name: /zoom/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /previous page|next page/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Page \d+ of/)).not.toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });
});
