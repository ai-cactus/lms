/**
 * AdminSlideEditor — in-place editing on the rendered slide.
 *
 * The assertion that matters is the last one in "saving": the admin edits one
 * sentence on one slide and the string handed to the Server Action is the
 * lesson's own source with exactly that sentence replaced — every wrapper,
 * class, locked badge and the whitespace between slides byte-identical. If that
 * stops holding, the editor is corrupting authored content, whatever else
 * passes.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

vi.mock('@/app/actions/course', () => ({ updateLessonSlideContent: vi.fn() }));

import { updateLessonSlideContent } from '@/app/actions/course';
import AdminSlideEditor from './AdminSlideEditor';

const TELL_SLIDE =
  '<div class="rich-slide slide-type-tell">' +
  '<span class="slide-type-badge slide-type-badge-tell">CONCEPT</span>' +
  '<h3 class="slide-heading">Protecting Client Information</h3>' +
  '<div class="slide-core-concept"><p>Every client record is protected health information.</p></div>' +
  '</div>';

const SHOW_SLIDE =
  '<div class="rich-slide slide-type-show">' +
  '<span class="slide-type-badge slide-type-badge-show">SCENARIO</span>' +
  '<h3 class="slide-heading">A Colleague Asks for a Chart</h3>' +
  '<div class="slide-scenario">' +
  '<div class="scenario-situation"><span class="scenario-tag">Situation</span> A nurse asks you to pull a chart.</div>' +
  '<div class="scenario-rationale"><span class="scenario-tag">Why</span> Familiarity is not authorisation.</div>' +
  '</div>' +
  '</div>';

const SLIDE_CONTENT = `${TELL_SLIDE}\n  ${SHOW_SLIDE}`;

function renderEditor(overrides: { slideContent?: string | null; content?: string } = {}) {
  const onNext = vi.fn();
  const onPrev = vi.fn();
  const onToggleView = vi.fn();

  render(
    <AdminSlideEditor
      lesson={{
        id: 'lesson-1',
        title: 'Module 1: Confidentiality',
        content: overrides.content ?? '<h2>Fallback</h2><p>Article body.</p>',
        slideContent: overrides.slideContent === undefined ? SLIDE_CONTENT : overrides.slideContent,
        moduleIndex: 0,
        totalModules: 2,
      }}
      onNext={onNext}
      onPrev={onPrev}
      isFirst
      isLast={false}
      onToggleView={onToggleView}
    />,
  );

  return { onNext, onPrev, onToggleView };
}

/** jsdom has no editing host, so drive a region the way a keystroke would. */
function typeInto(region: HTMLElement, text: string) {
  region.textContent = text;
  fireEvent.input(region, { target: region });
}

const regionNamed = (name: string) => screen.getByRole('textbox', { name });
const saveButton = () => screen.getByRole('button', { name: /Save Slides/ });

beforeEach(() => {
  vi.mocked(updateLessonSlideContent).mockReset();
  vi.mocked(updateLessonSlideContent).mockResolvedValue({ success: true });
});

describe('editable surface', () => {
  it('exposes every authored text region of the slide, each with a name', () => {
    renderEditor();

    expect(regionNamed('Slide heading')).toHaveTextContent('Protecting Client Information');
    expect(regionNamed('Core concept')).toHaveTextContent(
      'Every client record is protected health information.',
    );
  });

  it('leaves the pedagogical taxonomy locked and off the keyboard path', () => {
    renderEditor();

    const badge = document.querySelector('.slide-type-badge');
    expect(badge).toHaveTextContent('CONCEPT');
    expect(badge).not.toHaveAttribute('contenteditable');
    expect(screen.queryByRole('textbox', { name: /CONCEPT/ })).not.toBeInTheDocument();
  });

  it('keeps scenario prose editable while its tag stays locked', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /Go to slide 2/ }));

    expect(regionNamed('Scenario situation')).toHaveTextContent(
      'A nurse asks you to pull a chart.',
    );
    expect(document.querySelector('.scenario-tag')).not.toHaveAttribute('contenteditable');
  });

  it('falls back to the article HTML when a lesson has no generated slides', () => {
    renderEditor({ slideContent: null, content: '<h2>Legacy heading</h2><p>Legacy body.</p>' });

    expect(screen.getByRole('textbox', { name: 'Slide heading' })).toHaveTextContent(
      'Legacy heading',
    );
  });
});

describe('saving', () => {
  it('is offered only once something has changed', async () => {
    renderEditor();
    expect(saveButton()).toBeDisabled();

    typeInto(regionNamed('Slide heading'), 'Guarding Client Information');

    expect(saveButton()).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('sends the whole deck with exactly the edited text changed', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /Go to slide 2/ }));
    typeInto(regionNamed('Scenario rationale'), 'Familiarity is not authorization.');
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateLessonSlideContent).toHaveBeenCalledTimes(1));

    const [lessonId, saved] = vi.mocked(updateLessonSlideContent).mock.calls[0];
    expect(lessonId).toBe('lesson-1');
    expect(saved).toContain('Familiarity is not authorization.');
    // Undoing the one edit restores the source byte for byte — wrappers,
    // classes, locked badges and the gap between slides included.
    expect(saved.replace('authorization', 'authorisation')).toBe(SLIDE_CONTENT);
  });

  it('carries edits made on a slide the admin has navigated away from', async () => {
    renderEditor();

    typeInto(regionNamed('Slide heading'), 'Guarding Client Information');
    await userEvent.click(screen.getByRole('button', { name: /Go to slide 2/ }));
    typeInto(regionNamed('Scenario situation'), 'A nurse asks you to print a chart.');
    await userEvent.click(saveButton());

    await waitFor(() => expect(updateLessonSlideContent).toHaveBeenCalledTimes(1));

    const saved = vi.mocked(updateLessonSlideContent).mock.calls[0][1];
    expect(saved).toContain('<h3 class="slide-heading">Guarding Client Information</h3>');
    expect(saved).toContain('A nurse asks you to print a chart.');
    expect(saved).toContain('<span class="slide-type-badge slide-type-badge-show">SCENARIO</span>');
  });

  it('keeps an edit on screen after navigating back to its slide', async () => {
    renderEditor();

    typeInto(regionNamed('Slide heading'), 'Guarding Client Information');
    await userEvent.click(screen.getByRole('button', { name: /Go to slide 2/ }));
    await userEvent.click(screen.getByRole('button', { name: /Go to slide 1/ }));

    expect(regionNamed('Slide heading')).toHaveTextContent('Guarding Client Information');
  });

  it('reports a refused save in the shared alert and stays dirty', async () => {
    vi.mocked(updateLessonSlideContent).mockResolvedValue({
      success: false,
      error: 'This lesson could not be found in your organization, so it cannot be edited here.',
    });
    renderEditor();

    typeInto(regionNamed('Slide heading'), 'Guarding Client Information');
    await userEvent.click(saveButton());

    expect(
      await screen.findByText(
        'This lesson could not be found in your organization, so it cannot be edited here.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('confirms before leaving the module with unsaved edits', async () => {
    const { onToggleView } = renderEditor();

    typeInto(regionNamed('Slide heading'), 'Guarding Client Information');
    await userEvent.click(screen.getByRole('button', { name: 'View as Notes' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(onToggleView).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    expect(onToggleView).toHaveBeenCalledTimes(1);
  });
});
