/**
 * useUnsavedChangesBackGuard — the browser Back button on a page holding
 * unsaved work.
 *
 * The assertions that matter are the three under "cannot trap the user". A
 * history guard that gets this wrong is worse than the bug it fixes: someone
 * pressing Back against a dialog that keeps reinstating itself cannot leave the
 * page at all without closing the tab, whereas the bug this guards only costs
 * them the edits. So every test here ends by asking where the browser actually
 * is, not merely whether a callback fired.
 *
 * jsdom implements real session history — `pushState`, `back()` and the
 * asynchronous `popstate` that follows — so these drive the genuine stack
 * rather than a stand-in for it.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUnsavedChangesBackGuard } from './use-unsaved-changes-back-guard';

/**
 * jsdom keeps one session history for the whole file, so each test stamps its
 * own entries with a unique token and asserts against those rather than against
 * absolute stack positions.
 */
let token = 0;
let priorPage: string;
let hostPage: string;

/** Rebuilds "arrived at the editor from somewhere else" in front of each test. */
beforeEach(() => {
  token += 1;
  priorPage = `prior-${token}`;
  hostPage = `host-${token}`;
  window.history.pushState({ page: priorPage }, '');
  window.history.pushState({ page: hostPage }, '');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Where the browser is now, by the token the test stamped on the entry. */
function currentPage(): string | undefined {
  return (window.history.state as { page?: string } | null)?.page;
}

/** Whether the current entry is the guard's own throwaway one. */
function onSentinel(): boolean {
  return Boolean(
    (window.history.state as Record<string, unknown> | null)?.__lmsUnsavedChangesGuard,
  );
}

/** Presses Back and waits for the traversal jsdom performs asynchronously. */
async function pressBack(): Promise<void> {
  await act(async () => {
    const traversed = new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
    });
    window.history.back();
    await traversed;
  });
}

function renderGuard(enabled: boolean) {
  const onIntercept = vi.fn<(leave: () => void) => void>();
  const view = renderHook(
    ({ isDirty }: { isDirty: boolean }) =>
      useUnsavedChangesBackGuard({ enabled: isDirty, onIntercept }),
    { initialProps: { isDirty: enabled } },
  );
  return { ...view, onIntercept };
}

/** The `leave` callback handed to the most recent interception. */
function leaveFrom(onIntercept: ReturnType<typeof vi.fn>): () => void {
  return onIntercept.mock.calls.at(-1)![0] as () => void;
}

describe('arming', () => {
  it('parks exactly one history entry while there are unsaved changes', () => {
    const before = window.history.length;
    renderGuard(true);

    expect(window.history.length).toBe(before + 1);
    expect(onSentinel()).toBe(true);
  });

  it('touches nothing while the page is clean', async () => {
    const before = window.history.length;
    const { onIntercept } = renderGuard(false);

    expect(window.history.length).toBe(before);

    await pressBack();

    // The whole point of staying inert: a prompt people meet on every exit is
    // a prompt they dismiss without reading.
    expect(onIntercept).not.toHaveBeenCalled();
    expect(currentPage()).toBe(priorPage);
  });

  it('does not manufacture a Back target when nothing precedes the page', () => {
    // A tab opened straight onto the editor has an inert Back button. Parking a
    // sentinel would light it up and lead to a prompt whose confirmation has
    // nowhere to go — the trap, arrived at from the other direction.
    Object.defineProperty(window.history, 'length', { configurable: true, get: () => 1 });
    try {
      const before = window.history.state;
      renderGuard(true);

      expect(onSentinel()).toBe(false);
      expect(window.history.state).toBe(before);
    } finally {
      delete (window.history as unknown as Record<string, unknown>).length;
    }
  });

  it('reuses its entry across a save-then-edit-again cycle instead of stacking', () => {
    const before = window.history.length;
    const { rerender } = renderGuard(true);

    rerender({ isDirty: false });
    rerender({ isDirty: true });

    expect(window.history.length).toBe(before + 1);
  });
});

describe('intercepting Back', () => {
  it('absorbs the press without leaving the page', async () => {
    const { onIntercept } = renderGuard(true);

    await pressBack();

    expect(onIntercept).toHaveBeenCalledTimes(1);
    // Still on the page's own entry: the sentinel was spent, the page was not.
    expect(currentPage()).toBe(hostPage);
  });
});

describe('cannot trap the user', () => {
  it('confirming leaves on the first press, landing where the user aimed', async () => {
    const { onIntercept } = renderGuard(true);

    await pressBack();

    await act(async () => {
      const traversed = new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
      });
      leaveFrom(onIntercept)();
      await traversed;
    });

    expect(currentPage()).toBe(priorPage);
  });

  it('lets an insistent second press through rather than re-prompting', async () => {
    const { onIntercept } = renderGuard(true);

    await pressBack();
    await pressBack();

    // One dialog, never a queue of them — and the second press leaves for real
    // instead of bouncing off a reinstated entry.
    expect(onIntercept).toHaveBeenCalledTimes(1);
    expect(currentPage()).toBe(priorPage);
  });

  it('never re-arms after a confirmed exit', async () => {
    const { result, onIntercept } = renderGuard(true);

    await pressBack();
    act(() => leaveFrom(onIntercept)());

    const afterLeaving = window.history.length;
    act(() => result.current.rearm());

    // Re-arming into a traversal already in flight would push an entry the
    // browser is mid-way through leaving.
    expect(window.history.length).toBe(afterLeaving);
  });
});

describe('cancelling', () => {
  it('re-parks the guard so the next Back press is caught the same way', async () => {
    const { result, onIntercept } = renderGuard(true);

    await pressBack();
    act(() => result.current.rearm());

    expect(onSentinel()).toBe(true);

    await pressBack();

    expect(onIntercept).toHaveBeenCalledTimes(2);
    expect(currentPage()).toBe(hostPage);
  });

  it('is a no-op while the guard is still armed', async () => {
    const { result } = renderGuard(true);

    const armed = window.history.length;
    act(() => result.current.rearm());

    expect(window.history.length).toBe(armed);
  });
});

describe('disarming', () => {
  it('stops prompting once the changes are saved', async () => {
    const { rerender, onIntercept } = renderGuard(true);

    rerender({ isDirty: false });
    await pressBack();

    expect(onIntercept).not.toHaveBeenCalled();
    // The spent sentinel cannot be removed from the stack, so a saved editor
    // costs one inert Back press before the next one leaves. Never a prompt.
    expect(currentPage()).toBe(hostPage);

    await pressBack();
    expect(currentPage()).toBe(priorPage);
  });

  it('stops listening on unmount, including with a prompt still open', async () => {
    const { unmount, onIntercept } = renderGuard(true);

    await pressBack();
    expect(onIntercept).toHaveBeenCalledTimes(1);

    unmount();
    await pressBack();

    expect(onIntercept).toHaveBeenCalledTimes(1);
    expect(currentPage()).toBe(priorPage);
  });
});
