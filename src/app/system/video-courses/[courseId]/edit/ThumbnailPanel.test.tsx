import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRefresh, mockRegenerate, mockRemove } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockRegenerate: vi.fn(),
  mockRemove: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('next/image', () => ({
  default: ({ alt, src, unoptimized }: { alt: string; src: string; unoptimized?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} data-unoptimized={String(Boolean(unoptimized))} />
  ),
}));
vi.mock('@/app/actions/video-course', () => ({
  regenerateVideoCourseThumbnail: mockRegenerate,
  removeCustomVideoCourseThumbnail: mockRemove,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import ThumbnailPanel, { type ThumbnailPanelProps } from './ThumbnailPanel';

const URL = '/api/system/video-courses/c1/thumbnail?v=123';
const MB = 1024 * 1024;

function renderPanel(overrides: Partial<ThumbnailPanelProps> = {}) {
  return render(
    <ThumbnailPanel
      courseId="c1"
      source="lesson"
      imageUrl={URL}
      regenerateBlockedReason={null}
      maxUploadBytes={5 * MB}
      {...overrides}
    />,
  );
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

const pngFile = (size = 1000) => {
  const file = new File(['x'], 'thumb.png', { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRegenerate.mockResolvedValue({ success: true });
  mockRemove.mockResolvedValue({ success: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThumbnailPanel — display', () => {
  it.each([
    ['custom', 'Custom upload'],
    ['preview', 'Generated from preview video'],
    ['lesson', 'Generated from lesson video'],
    ['none', 'None — placeholder shown'],
  ] as const)('labels the %s source', (source, label) => {
    renderPanel({ source, imageUrl: source === 'none' ? null : URL });

    expect(screen.getByTestId('thumbnail-source')).toHaveTextContent(label);
  });

  it('shows the current image from the versioned route, unoptimized', () => {
    renderPanel();

    const img = screen.getByAltText('Current course thumbnail');
    expect(img).toHaveAttribute('src', URL);
    expect(img).toHaveAttribute('data-unoptimized', 'true');
  });

  it('shows no image when there is no source', () => {
    renderPanel({ source: 'none', imageUrl: null });

    expect(screen.queryByAltText('Current course thumbnail')).toBeNull();
  });

  it('only enables Remove custom for a custom thumbnail', () => {
    const { rerender } = renderPanel({ source: 'preview' });
    expect(screen.getByRole('button', { name: /remove custom/i })).toBeDisabled();

    rerender(
      <ThumbnailPanel
        courseId="c1"
        source="custom"
        imageUrl={URL}
        regenerateBlockedReason={null}
        maxUploadBytes={5 * MB}
      />,
    );
    expect(screen.getByRole('button', { name: /remove custom/i })).toBeEnabled();
  });

  it('disables Regenerate and explains why when the lesson video is not ready', () => {
    renderPanel({
      regenerateBlockedReason: 'Available once the course video has finished processing.',
    });

    const button = screen.getByRole('button', { name: /regenerate from video/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      'Available once the course video has finished processing.',
    );
  });

  it('restricts the picker to JPEG, PNG and WebP', () => {
    const { container } = renderPanel();

    expect(fileInput(container)).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });
});

describe('ThumbnailPanel — upload', () => {
  it('posts the file to the upload route and refreshes on success', async () => {
    const { container } = renderPanel();
    const file = pngFile();

    await userEvent.upload(fileInput(container), file);

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/system/video-courses/c1/thumbnail');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('image')).toBe(file);
  });

  it('rejects an oversized file before uploading', async () => {
    const { container } = renderPanel({ maxUploadBytes: 1 * MB });

    await userEvent.upload(fileInput(container), pngFile(2 * MB));

    expect(await screen.findByText('Image exceeds 1 MB.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a disallowed type before uploading', async () => {
    const { container } = renderPanel();
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' });

    await userEvent.upload(fileInput(container), gif, { applyAccept: false });

    expect(await screen.findByText('Image must be JPEG, PNG or WebP.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the route error and does not refresh', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'The file is not a readable image' }), { status: 400 }),
    );
    const { container } = renderPanel();

    await userEvent.upload(fileInput(container), pngFile());

    expect(await screen.findByText('The file is not a readable image')).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('shows a loading state while uploading', async () => {
    let resolveFetch: (r: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    const { container } = renderPanel();

    await userEvent.upload(fileInput(container), pngFile());

    const button = screen.getByRole('button', { name: /upload image/i });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: /regenerate from video/i })).toBeDisabled();

    resolveFetch(new Response('{}', { status: 201 }));
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });
});

describe('ThumbnailPanel — actions', () => {
  it('regenerates and refreshes', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /regenerate from video/i }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce());
    expect(mockRegenerate).toHaveBeenCalledWith('c1');
  });

  it('shows a returned refusal without refreshing', async () => {
    mockRegenerate.mockResolvedValue({
      success: false,
      error: 'Could not take a frame from the course video.',
    });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /regenerate from video/i }));

    expect(
      await screen.findByText('Could not take a frame from the course video.'),
    ).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('removes a custom thumbnail and refreshes', async () => {
    renderPanel({ source: 'custom' });

    await userEvent.click(screen.getByRole('button', { name: /remove custom/i }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce());
    expect(mockRemove).toHaveBeenCalledWith('c1');
  });

  it('shows a generic error when the action call itself fails', async () => {
    mockRemove.mockRejectedValue(new Error('network'));
    renderPanel({ source: 'custom' });

    await userEvent.click(screen.getByRole('button', { name: /remove custom/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });
});
