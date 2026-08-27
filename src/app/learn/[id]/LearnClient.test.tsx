/**
 * LearnClient — server-seeded vs client-fetched startup (PR 6).
 *
 * The learn page now server-renders its payload and passes it in as
 * `initialData`. Two things have to hold for that to be safe:
 *  1. With `initialData` the mount fetch never runs, there is no loading state,
 *     and every value the fetch used to seed is already in the FIRST render —
 *     that is what puts the <video> src/poster into the initial HTML.
 *  2. Without `initialData` the old fetch path is intact and behaves as before;
 *     it is the fallback whenever the server render could not produce a payload.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'course-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

vi.mock('@/app/actions/video-progress', () => ({
  getVideoPlaybackUrl: vi.fn(),
  saveVideoProgress: vi.fn().mockResolvedValue(undefined),
}));

import { saveVideoProgress } from '@/app/actions/video-progress';
import type { LearnPayload } from '@/lib/learn/get-learn-payload';
import LearnClient from './LearnClient';

const makePayload = (overrides: Partial<LearnPayload> = {}): LearnPayload => ({
  course: {
    id: 'course-1',
    title: 'Bloodborne Pathogens',
    description: 'Annual refresher',
    duration: 45,
    lessons: [
      {
        id: 'lesson-1',
        title: 'Exposure control',
        content: '<p>Lesson body</p>',
        slideContent: null,
        duration: 45,
        order: 1,
        videoProvider: 'self',
        videoStorageUri: 'minio://videos/lesson-1.mp4',
        videoDurationSeconds: 600,
      },
    ],
    quiz: {
      id: 'quiz-1',
      title: 'Final quiz',
      passingScore: 70,
      allowedAttempts: 3,
      timeLimit: 10,
      questions: [
        { id: 'q1', text: 'What is 2+2?', type: 'single', options: ['3', '4', '5'] },
        { id: 'q2', text: 'What is 3+3?', type: 'single', options: ['5', '6', '7'] },
      ],
    },
  },
  enrollment: {
    id: 'enr-1',
    progress: 0,
    status: 'in_progress',
    score: null,
    videoPositionSeconds: 0,
    quizAttempts: [],
  },
  quizResultsData: null,
  user: {
    name: 'Jane Worker',
    role: 'nurse',
    isAdminView: false,
    organizationName: 'Acme Health',
    email: 'jane@example.com',
    jobTitle: 'RN',
  },
  ...overrides,
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LearnClient with server-provided initialData', () => {
  it('renders the lesson video on the first paint without fetching', () => {
    const { container } = render(<LearnClient initialData={makePayload()} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Loading...')).toBeNull();

    // The whole point of the SSR pass: src and poster are in the markup the
    // browser parses, not something hydration has to go and ask for.
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', '/api/video/lesson-1');
    expect(video).toHaveAttribute('poster', '/api/video/lesson-1/poster');
    // The lesson title shows in both the article body and the module rail.
    expect(screen.getAllByText('Exposure control').length).toBeGreaterThan(0);
  });

  it('seeds the video watch-gate from the resumed position, not from enrollment.progress', () => {
    const payload = makePayload();
    // 570/600 = 95% watched — at the gate — while progress says the lessons were
    // never navigated. The gate hint must be gone.
    payload.enrollment.videoPositionSeconds = 570;

    render(<LearnClient initialData={payload} />);

    expect(screen.queryAllByText('Watch the video to unlock the quiz')).toHaveLength(0);
  });

  it('keeps the quiz gated when the resumed position is short of the gate', () => {
    const payload = makePayload();
    payload.enrollment.videoPositionSeconds = 60;

    render(<LearnClient initialData={payload} />);

    expect(screen.getAllByText('Watch the video to unlock the quiz').length).toBeGreaterThan(0);
  });

  it('restores an in-progress attempt straight into the active quiz, answers included', () => {
    const payload = makePayload();
    payload.enrollment.quizAttempts = [
      {
        id: 'qa-active',
        score: 0,
        attemptCount: 2,
        answers: [{ questionId: 'q1', selectedAnswer: '4' }],
        timeTaken: null,
        completedAt: new Date().toISOString(),
      },
    ];

    const { container } = render(<LearnClient initialData={payload} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 2 | Attempt 2 of 3')).toBeInTheDocument();
    // The saved answer is restored as the selected option.
    expect(container.querySelector('[data-quiz-option="1"]')).toHaveAttribute(
      'data-selected',
      'true',
    );
  });

  it('preloads only the active lesson, never the other N-1 players', () => {
    // Article view is the default and mounts every lesson at once. Each
    // `preload="metadata"` costs an authenticated Range request plus a poster
    // fetch — 2N requests on a phone, competing with the video the learner
    // actually pressed play on.
    const payload = makePayload();
    payload.course.lessons = [
      payload.course.lessons[0],
      { ...payload.course.lessons[0], id: 'lesson-2', title: 'Sharps handling' },
      { ...payload.course.lessons[0], id: 'lesson-3', title: 'Spill response' },
    ];

    const { container } = render(<LearnClient initialData={payload} />);

    const preloads = [...container.querySelectorAll('video')].map((v) => v.getAttribute('preload'));
    expect(preloads).toEqual(['metadata', 'none', 'none']);
  });

  it('lets only the active lesson write the (single, shared) enrollment progress', () => {
    const payload = makePayload();
    payload.course.lessons = [
      payload.course.lessons[0],
      { ...payload.course.lessons[0], id: 'lesson-2', title: 'Sharps handling' },
    ];

    const { container } = render(<LearnClient initialData={payload} />);
    const inactive = container.querySelectorAll('video')[1];
    Object.defineProperty(inactive, 'duration', { configurable: true, value: 600 });
    Object.defineProperty(inactive, 'currentTime', {
      configurable: true,
      writable: true,
      value: 5,
    });

    fireEvent.timeUpdate(inactive);

    // Playing lesson 2 while lesson 1 is active must not persist lesson 2's
    // position as *the* enrollment position — that seeds the watch-gate from
    // the wrong lesson on the next load.
    expect(saveVideoProgress).not.toHaveBeenCalled();
  });

  it('lands a retake-pending enrollment on the quiz intro screen', () => {
    const payload = makePayload();
    payload.enrollment.score = null;
    payload.enrollment.quizAttempts = [
      {
        id: 'qa-1',
        score: 40,
        attemptCount: 1,
        answers: [],
        timeTaken: 120,
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    ];

    render(<LearnClient initialData={payload} />);

    expect(screen.getByRole('button', { name: 'Start Quiz' })).toBeInTheDocument();
    expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument();
  });
});

describe('LearnClient without initialData', () => {
  it('falls back to the learn API and renders once it resolves', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => makePayload() });

    const { container } = render(<LearnClient />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByText('Exposure control').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/course-1/learn');
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/video/lesson-1');
  });

  it('surfaces the inline error state when the fallback fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    render(<LearnClient />);

    await waitFor(() =>
      expect(screen.getByText('Error: Failed to load course')).toBeInTheDocument(),
    );
  });
});

/**
 * Free module navigation (feature/free-module-navigation, commit f2939fa).
 *
 * QA finding #3: clicking a later Table of Contents entry did nothing, because
 * the ToC handler gated selection on `index <= highestUnlockedIndex`. The fix
 * lets learners open any module, but MUST NOT let browsing advance
 * `highestUnlockedIndex` or call `updateProgress` — that index is exactly what
 * gates quiz entry. If free navigation ever touched it, clicking the last ToC
 * entry would instantly unlock the quiz and bypass "Complete All Modules
 * First" — a compliance hole, not just a nav convenience.
 */
const textLesson = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title,
  content: `<p>${title} body</p>`,
  slideContent: null,
  duration: 10,
  order: 1,
  videoProvider: null,
  videoStorageUri: null,
  videoDurationSeconds: null,
  ...overrides,
});

describe('Free module navigation (feature/free-module-navigation)', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView; scrollToModule also defers
    // through requestAnimationFrame, which must resolve synchronously so the
    // click's effects are observable inside the test without an extra await.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = function scrollIntoViewNoop() {};
    }
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it('selecting the LAST module via the ToC does not unlock the quiz — "Complete All Modules First" still gates entry', () => {
    const payload = makePayload();
    payload.course.lessons = [
      textLesson('lesson-1', 'Module 1: Intro'),
      textLesson('lesson-2', 'Module 2: Hazards'),
      textLesson('lesson-3', 'Module 3: Response'),
    ];

    render(<LearnClient initialData={payload} />);

    const toc = screen.getByText('Table of Contents').parentElement!;
    const tocButtons = within(toc).getAllByRole('button');
    expect(tocButtons).toHaveLength(4); // 3 lessons + quiz row

    // Jump straight to the last module — never visited module 2.
    fireEvent.click(tocButtons[2]);
    // Then try to enter the quiz directly from the ToC.
    fireEvent.click(tocButtons[3]);

    // If free navigation had advanced highestUnlockedIndex, this would be the
    // "Ready for the Quiz?" gate modal instead — the distinction IS the test.
    expect(screen.getByText('Complete All Modules First')).toBeInTheDocument();
    expect(screen.queryByText('Ready for the Quiz?')).not.toBeInTheDocument();
    expect(screen.queryByText('Start Quiz')).not.toBeInTheDocument();
  });

  it('selecting a middle module via the ToC moves the active module and scrolls it into view, without persisting progress', () => {
    const payload = makePayload();
    payload.course.lessons = [
      textLesson('lesson-1', 'Module 1: Intro'),
      textLesson('lesson-2', 'Module 2: Hazards'),
      textLesson('lesson-3', 'Module 3: Response'),
    ];

    const { container } = render(<LearnClient initialData={payload} />);

    const moduleEls = [0, 1, 2].map((i) => container.querySelector(`#module-${i}`) as HTMLElement);
    const spies = moduleEls.map((el) =>
      vi.spyOn(el, 'scrollIntoView').mockImplementation(() => {}),
    );

    const toc = screen.getByText('Table of Contents').parentElement!;
    const tocButtons = within(toc).getAllByRole('button');
    fireEvent.click(tocButtons[1]); // middle module

    expect(spies[1]).toHaveBeenCalledTimes(1);
    expect(spies[0]).not.toHaveBeenCalled();
    expect(spies[2]).not.toHaveBeenCalled();

    // Free browsing must never persist progress via the enrollment endpoint.
    const progressCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/progress'));
    expect(progressCalls).toHaveLength(0);
  });

  it('progress through Next still advances highestUnlockedIndex and persists to the server (regression guard)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const payload = makePayload();
    payload.course.lessons = [
      textLesson('lesson-1', 'Module 1: Intro'),
      textLesson('lesson-2', 'Module 2: Hazards'),
    ];

    render(<LearnClient initialData={payload} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // module 1 -> module 2 (last)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments/enr-1/progress',
        expect.objectContaining({ body: JSON.stringify({ progress: 100 }) }),
      );
    });

    // Reaching the end with earned progress hits the "ready" gate, never the
    // "incomplete" one — proof highestUnlockedIndex was genuinely advanced.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Ready for the Quiz?')).toBeInTheDocument();
    expect(screen.queryByText('Complete All Modules First')).not.toBeInTheDocument();
  });

  it('the video watch-gate still blocks quiz entry after free-navigating straight to the last (video) module', () => {
    const payload = makePayload();
    payload.course.lessons = [
      textLesson('lesson-1', 'Module 1: Intro'),
      {
        id: 'lesson-2',
        title: 'Module 2: Procedure video',
        content: '<p>video lesson</p>',
        slideContent: null,
        duration: 10,
        order: 2,
        videoProvider: 'self',
        videoStorageUri: 'minio://videos/lesson-2.mp4',
        videoDurationSeconds: 600,
      },
    ];
    payload.enrollment.videoPositionSeconds = 0; // unwatched

    render(<LearnClient initialData={payload} />);

    const toc = screen.getByText('Table of Contents').parentElement!;
    const tocButtons = within(toc).getAllByRole('button');
    fireEvent.click(tocButtons[1]); // jump directly to the unwatched video module
    fireEvent.click(tocButtons[2]); // attempt quiz entry from the ToC

    // isVideoQuizGateBlocked() returns before either modal — neither appears,
    // and the quiz is never entered.
    expect(screen.queryByText('Complete All Modules First')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready for the Quiz?')).not.toBeInTheDocument();
    expect(screen.queryByText('Start Quiz')).not.toBeInTheDocument();
  });
});
