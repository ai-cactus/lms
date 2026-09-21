/**
 * AdminLessonEditor — the "Edit Article" affordance and its failure reporting.
 *
 * Two defects, one cause. The editor rendered on the strength of `isAdminView`,
 * which only means "may REVIEW this course": a supervisor (no `course.edit`)
 * and any admin on an adopted global catalogue course both saw the button and
 * were refused on every save. Worse, the refusal was `throw`n by the Server
 * Action, and React redacts thrown Server Action messages to error #441 in
 * production — so the user got `alert('Failed to save changes')` and no reason
 * at all.
 *
 * `canEdit` now gates the control, and refusals arrive as a returned
 * `{ success: false, error }` rendered in the shared `Alert`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

vi.mock('@/app/actions/course', () => ({ updateLessonContent: vi.fn() }));

// The rich-text editor is a `next/dynamic` client-only import; its internals
// are irrelevant here and pulling Quill into jsdom is not.
vi.mock('react-quill-new', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Lesson body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { updateLessonContent } from '@/app/actions/course';
import AdminLessonEditor from './AdminLessonEditor';

const lesson = {
  id: 'lesson-1',
  title: 'Exposure control',
  content: '<p>Lesson body</p>',
  moduleIndex: 0,
  totalModules: 1,
};

const renderEditor = (canEdit: boolean) =>
  render(
    <AdminLessonEditor
      lesson={lesson}
      canEdit={canEdit}
      onNext={vi.fn()}
      onPrev={vi.fn()}
      isFirst
      isLast
    />,
  );

const editButton = () => screen.queryByRole('button', { name: /Edit Article/ });

beforeEach(() => {
  vi.mocked(updateLessonContent).mockReset();
});

describe('AdminLessonEditor — the edit affordance is honest', () => {
  it('offers "Edit Article" when the viewer may actually save', () => {
    renderEditor(true);

    expect(editButton()).toBeInTheDocument();
  });

  // A supervisor, or any admin on a global course another org authored.
  it('hides "Edit Article" entirely when the viewer can never save', () => {
    renderEditor(false);

    expect(editButton()).not.toBeInTheDocument();
  });

  it('still renders the lesson for read-only review when editing is not offered', () => {
    renderEditor(false);

    expect(screen.getByText('Exposure control')).toBeInTheDocument();
    expect(screen.getByText(/Lesson body/)).toBeInTheDocument();
  });
});

describe('AdminLessonEditor — refusals are shown, not swallowed', () => {
  const enterEditMode = () => {
    renderEditor(true);
    fireEvent.click(editButton()!);
  };

  it('renders the returned reason in an in-page alert and stays in edit mode', async () => {
    vi.mocked(updateLessonContent).mockResolvedValue({
      success: false,
      error: 'Your role does not have permission to edit course content.',
    });
    enterEditMode();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your role does not have permission to edit course content.');
    // The unsaved edits must survive the refusal.
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  });

  it('surfaces the PHI gate’s own wording verbatim', async () => {
    vi.mocked(updateLessonContent).mockResolvedValue({
      success: false,
      error: 'This content appears to contain PHI and cannot be saved.',
    });
    enterEditMode();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This content appears to contain PHI and cannot be saved.',
    );
  });

  it('leaves edit mode and shows no alert on a successful save', async () => {
    vi.mocked(updateLessonContent).mockResolvedValue({ success: true });
    enterEditMode();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(editButton()).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to a generic message when the action throws unexpectedly', async () => {
    vi.mocked(updateLessonContent).mockRejectedValue(new Error('network down'));
    enterEditMode();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong while saving. Please try again.',
    );
  });

  it('clears a previous refusal when the viewer cancels', async () => {
    vi.mocked(updateLessonContent).mockResolvedValue({ success: false, error: 'Refused.' });
    enterEditMode();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
