/**
 * Tests for the wizard's step-7 article review: the design's category chip,
 * meta line, lesson pager, and the right rail's Table of Content / Sources
 * toggle.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import WizardReviewArticle from './WizardReviewArticle';
import { RenderableModule } from '@/types/course';

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
Element.prototype.scrollIntoView = vi.fn();

const LESSONS: RenderableModule[] = [
  {
    id: 'm0-0',
    title: 'Benefits of CARF Principles',
    content: '<p>Intro paragraph.</p><h4>Why it matters</h4><p>Body copy for the section.</p>',
    slideContent: '<div class="rich-slide"><h3 class="slide-heading">Benefits</h3></div>',
    duration: '10 min',
    order: 0,
    moduleIndex: 0,
    moduleTitle: 'CARF Basics',
    keyPoints: ['Document every deviation'],
  },
  {
    id: 'm0-1',
    title: 'Challenges for CARF compliance',
    content: '<p>Second lesson body.</p>',
    slideContent: '',
    duration: '10 min',
    order: 1,
    moduleIndex: 0,
    moduleTitle: 'CARF Basics',
  },
];

function renderArticle(overrides: Partial<React.ComponentProps<typeof WizardReviewArticle>> = {}) {
  const onSelectLesson = vi.fn();
  const onViewSlides = vi.fn();

  render(
    <WizardReviewArticle
      courseTitle="10 Fundamental CARF Principles You Need to Know"
      courseDescription="Master the principles behind CARF accreditation."
      categoryName="CARF Policy"
      lessons={LESSONS}
      activeIndex={0}
      onSelectLesson={onSelectLesson}
      onViewSlides={onViewSlides}
      lastUpdatedLabel="Jan 12, 2024"
      sourceDocumentName="Source document.pdf"
      sourceExcerpt="The content on the Compliance and Regulatory Framework was developed…"
      {...overrides}
    />,
  );

  return { onSelectLesson, onViewSlides };
}

describe('WizardReviewArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the category chip from the category step', () => {
    renderArticle();
    expect(screen.getByText('CARF Policy')).toBeInTheDocument();
  });

  it('omits the category chip when the category name could not be resolved', () => {
    renderArticle({ categoryName: '' });
    expect(screen.queryByText('CARF Policy')).not.toBeInTheDocument();
  });

  it('renders the course heading and the meta line with a derived read time', () => {
    renderArticle();
    expect(
      screen.getByRole('heading', { name: '10 Fundamental CARF Principles You Need to Know' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Last update: Jan 12, 2024')).toBeInTheDocument();
    expect(screen.getByText('1 min read')).toBeInTheDocument();
  });

  it('lists the current lesson section headings in the Table of Content', () => {
    renderArticle();
    const toc = screen.getByRole('navigation', { name: 'Table of Content' });

    expect(
      within(toc).getByRole('button', { name: 'Benefits of CARF Principles' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(within(toc).getByRole('button', { name: 'Why it matters' })).toBeInTheDocument();
    expect(
      within(toc).queryByRole('button', { name: 'Challenges for CARF compliance' }),
    ).not.toBeInTheDocument();
  });

  it('scrolls to a section and highlights it when its outline entry is clicked', async () => {
    const user = userEvent.setup();
    renderArticle();
    const toc = screen.getByRole('navigation', { name: 'Table of Content' });

    await user.click(within(toc).getByRole('button', { name: 'Why it matters' }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(within(toc).getByRole('button', { name: 'Why it matters' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('pages between lessons and stops at the first one', async () => {
    const user = userEvent.setup();
    const { onSelectLesson } = renderArticle();

    expect(screen.getByRole('button', { name: /Previous Lesson/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Next Lesson/ }));
    expect(onSelectLesson).toHaveBeenCalledWith(1);
  });

  it('stops the pager at the last lesson', () => {
    renderArticle({ activeIndex: 1 });
    expect(screen.getByRole('button', { name: /Next Lesson/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Previous Lesson/ })).toBeEnabled();
  });

  it('renders the active lesson section and only its own key points', () => {
    renderArticle();
    expect(screen.getByText('Key Points')).toBeInTheDocument();
    expect(screen.getByText('Document every deviation')).toBeInTheDocument();

    screen.getByRole('heading', { name: 'Benefits of CARF Principles' });
  });

  it('drops the key points callout for a lesson that has none', () => {
    renderArticle({ activeIndex: 1 });
    expect(
      screen.getByRole('heading', { name: 'Challenges for CARF compliance' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Key Points')).not.toBeInTheDocument();
  });

  it('swaps the rail to the source document chip and back', async () => {
    const user = userEvent.setup();
    renderArticle();

    expect(screen.getByRole('navigation', { name: 'Table of Content' })).toBeInTheDocument();
    expect(screen.queryByText('Source document.pdf')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sources' }));

    expect(screen.getByText('Source document.pdf')).toBeInTheDocument();
    expect(
      screen.getByText(/The content on the Compliance and Regulatory Framework/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Table of Content' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Table of Content' }));
    expect(screen.getByRole('navigation', { name: 'Table of Content' })).toBeInTheDocument();
  });

  it('shows the file chip alone when no source excerpt reached the client', async () => {
    const user = userEvent.setup();
    renderArticle({ sourceExcerpt: undefined });

    await user.click(screen.getByRole('button', { name: 'Sources' }));

    expect(screen.getByText('Source document.pdf')).toBeInTheDocument();
    expect(
      screen.queryByText(/The content on the Compliance and Regulatory Framework/),
    ).not.toBeInTheDocument();
  });

  it('switches to the slide deck', async () => {
    const user = userEvent.setup();
    const { onViewSlides } = renderArticle();

    await user.click(screen.getByRole('button', { name: 'View as Slides' }));
    expect(onViewSlides).toHaveBeenCalled();
  });

  it('renders the Edit affordance as inert until post-publish editing exists', () => {
    renderArticle();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
  });
});
