/**
 * CourseRail — first tests for this component.
 *
 * `unlockedIndex` is overloaded to gate TWO different things:
 *   - a lesson tile:  isLocked = i > unlockedIndex
 *   - the quiz tile:  disabled = lessons.length > unlockedIndex || disableNav
 *
 * That means `unlockedIndex = lessons.length - 1` (every lesson open, quiz
 * still earned) and `unlockedIndex = lessons.length` (everything open,
 * including the quiz) are exactly one apart. LearnClient relies on that gap
 * to let learners freely browse lessons while keeping the quiz gated behind
 * `handleNext` — see LearnClient.test.tsx's "Free module navigation" suite.
 * These tests pin CourseRail's half of that contract so a future edit that
 * "simplifies" the two locks back into one silently reopens the quiz.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CourseRail from './CourseRail';

const lessons = [
  { id: 'l1', title: 'Module 1: Intro' },
  { id: 'l2', title: 'Module 2: Hazards' },
  { id: 'l3', title: 'Module 3: Response' },
];
const quiz = { id: 'quiz-1', title: 'Final Quiz' };

describe('CourseRail', () => {
  it('renders every unlocked lesson tile as enabled and calls onSelect with its index on click', () => {
    const onSelect = vi.fn();
    render(
      <CourseRail
        lessons={lessons}
        activeIndex={0}
        onSelect={onSelect}
        unlockedIndex={2}
        quiz={quiz}
      />,
    );

    const tiles = screen.getAllByRole('button', { name: /Intro|Hazards|Response/ });
    expect(tiles).toHaveLength(3);
    tiles.forEach((tile) => expect(tile).not.toBeDisabled());

    fireEvent.click(tiles[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('locks tiles past unlockedIndex — shows the lock glyph, disables the button, and never calls onSelect', () => {
    const onSelect = vi.fn();
    render(
      <CourseRail
        lessons={lessons}
        activeIndex={0}
        onSelect={onSelect}
        unlockedIndex={0}
        quiz={quiz}
      />,
    );

    // Module 3 (index 2) is the furthest past unlockedIndex=0, guaranteed locked.
    const allTiles = screen.getAllByTitle(/Module \d/);
    const module3 = allTiles.find((t) => t.getAttribute('title') === 'Module 3: Response')!;
    expect(module3).toBeDisabled();
    expect(module3).toHaveTextContent('🔒');

    fireEvent.click(module3);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('not-yet-unlocked state (unlockedIndex = lessons.length - 1): every lesson tile is selectable AND the quiz tile stays disabled', () => {
    // This is exactly the value LearnClient's railUnlockedIndex computes while
    // quizUnlocked is false — free lesson browsing, quiz still earned.
    const onSelect = vi.fn();
    render(
      <CourseRail
        lessons={lessons}
        activeIndex={0}
        onSelect={onSelect}
        unlockedIndex={lessons.length - 1}
        quiz={quiz}
      />,
    );

    const lessonTiles = screen.getAllByTitle(/^Module \d/);
    expect(lessonTiles).toHaveLength(3);
    lessonTiles.forEach((tile) => expect(tile).not.toBeDisabled());
    lessonTiles.forEach((tile) => expect(tile).not.toHaveTextContent('🔒'));

    const quizTile = screen.getByTitle('Final Quiz');
    expect(quizTile).toBeDisabled();
    expect(quizTile).toHaveTextContent('🔒');

    fireEvent.click(quizTile);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('raising unlockedIndex to lessons.length also enables the quiz tile — documents the shared-prop trap, does not endorse it', () => {
    // If a future change ever raises LearnClient's railUnlockedIndex to
    // lessons.length (or 9999) before the quiz is genuinely earned, THIS is
    // the effect: the quiz tile becomes clickable. That must only happen once
    // quizUnlocked/quizResults/admin is true.
    const onSelect = vi.fn();
    render(
      <CourseRail
        lessons={lessons}
        activeIndex={0}
        onSelect={onSelect}
        unlockedIndex={lessons.length}
        quiz={quiz}
      />,
    );

    const quizTile = screen.getByTitle('Final Quiz');
    expect(quizTile).not.toBeDisabled();
    expect(quizTile).toHaveTextContent('QUIZ');

    fireEvent.click(quizTile);
    expect(onSelect).toHaveBeenCalledWith(lessons.length);
  });

  it('disableNav disables every tile — lessons, quiz, and Exit — regardless of unlockedIndex', () => {
    const onSelect = vi.fn();
    const onExitClick = vi.fn();
    render(
      <CourseRail
        lessons={lessons}
        activeIndex={0}
        onSelect={onSelect}
        unlockedIndex={lessons.length}
        quiz={quiz}
        disableNav
        onExitClick={onExitClick}
      />,
    );

    screen.getAllByTitle(/^Module \d/).forEach((tile) => expect(tile).toBeDisabled());
    expect(screen.getByTitle('Final Quiz')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Exit/ })).toBeDisabled();

    fireEvent.click(screen.getByTitle('Final Quiz'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('defaults unlockedIndex to 9999 (fully open) when the prop is omitted', () => {
    const onSelect = vi.fn();
    render(<CourseRail lessons={lessons} activeIndex={0} onSelect={onSelect} quiz={quiz} />);

    screen.getAllByTitle(/^Module \d/).forEach((tile) => expect(tile).not.toBeDisabled());
    expect(screen.getByTitle('Final Quiz')).not.toBeDisabled();
  });

  it('calls onClose after a selection (mobile rail auto-close)', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <CourseRail
        lessons={lessons}
        activeIndex={0}
        onSelect={onSelect}
        unlockedIndex={lessons.length}
        quiz={quiz}
        isOpen
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getAllByTitle(/^Module \d/)[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
