import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PENDING_GENERATION_KEY,
  PENDING_GENERATION_MAX_AGE_MS,
  clearPendingGeneration,
  readPendingGeneration,
  writePendingGeneration,
} from './pending-generation';

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('readPendingGeneration', () => {
  it('round-trips the jobs written for a multi-module run', () => {
    writePendingGeneration([
      { moduleIndex: 0, jobId: 'job-a' },
      { moduleIndex: 1, jobId: 'job-b' },
    ]);

    expect(readPendingGeneration()?.jobs).toEqual([
      { moduleIndex: 0, jobId: 'job-a' },
      { moduleIndex: 1, jobId: 'job-b' },
    ]);
  });

  it('discards the pre-module single-job payload instead of resuming it', () => {
    // The v1 shape written by the single-document pipeline.
    localStorage.setItem(
      PENDING_GENERATION_KEY,
      JSON.stringify({ jobId: 'legacy-job', formData: {}, timestamp: Date.now() }),
    );

    expect(readPendingGeneration()).toBeNull();
    expect(localStorage.getItem(PENDING_GENERATION_KEY)).toBeNull();
  });

  it('discards an unparseable payload', () => {
    localStorage.setItem(PENDING_GENERATION_KEY, '{not json');

    expect(readPendingGeneration()).toBeNull();
    expect(localStorage.getItem(PENDING_GENERATION_KEY)).toBeNull();
  });

  it('discards a payload whose jobs are malformed', () => {
    localStorage.setItem(
      PENDING_GENERATION_KEY,
      JSON.stringify({ version: 2, jobs: [{ moduleIndex: 0 }], timestamp: Date.now() }),
    );

    expect(readPendingGeneration()).toBeNull();
    expect(localStorage.getItem(PENDING_GENERATION_KEY)).toBeNull();
  });

  it('discards a run that is older than the max age', () => {
    localStorage.setItem(
      PENDING_GENERATION_KEY,
      JSON.stringify({
        version: 2,
        jobs: [{ moduleIndex: 0, jobId: 'job-a' }],
        timestamp: Date.now() - PENDING_GENERATION_MAX_AGE_MS - 1,
      }),
    );

    expect(readPendingGeneration()).toBeNull();
    expect(localStorage.getItem(PENDING_GENERATION_KEY)).toBeNull();
  });

  it('returns null when nothing is pending', () => {
    expect(readPendingGeneration()).toBeNull();
  });
});

describe('writePendingGeneration', () => {
  it('does not persist an empty job list', () => {
    writePendingGeneration([]);
    expect(localStorage.getItem(PENDING_GENERATION_KEY)).toBeNull();
  });
});

describe('clearPendingGeneration', () => {
  it('removes a stored run', () => {
    writePendingGeneration([{ moduleIndex: 0, jobId: 'job-a' }]);
    clearPendingGeneration();
    expect(readPendingGeneration()).toBeNull();
  });
});
