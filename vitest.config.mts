import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // `.claude/worktrees/**` holds full checkouts created for parallel agent
    // work. vitest walks them, so a leftover worktree makes a bare run report
    // hundreds of phantom failures from a stale copy of the tree. `.git/info/exclude`
    // hides them from git but not from vitest, and this repo leans on the LOCAL
    // heavy tier for pre-push, so a run that looks broken is a real cost.
    exclude: [...defaultExclude, 'tests/e2e/**/*', '.claude/**'],
    // Local dev boxes have many cores but comparatively little RAM per core.
    // Unbounded, vitest spawns one jsdom fork per core (22 here), which starved
    // React's act() timers, producing intermittent failures in Step2Modules /
    // InviteStaffModal / upload-modal / AddFacilityModal that all pass in
    // isolation — the reason pre-push was being bypassed with --no-verify.
    // Measured over 121 specs: unbounded = 30s wall / 229s environment with a
    // reproduced act() failure; 50% = 38s wall / 119s environment, green.
    // CI runners are 2-4 cores, where halving would be a real slowdown.
    //
    // RE-MEASURED 2026-09-15 at 313 specs / 5151 tests — 2.6x the original
    // sample — because the suite had outgrown the figures above and two specs
    // were flaking on pre-push. On the same 22-core / 15GB box, run INTERLEAVED
    // (this box drifts several seconds slower over a long session, so settings
    // measured an hour apart are not comparable — an earlier sequential pass
    // overstated the gap by half):
    //   50% (11 workers) — 73.8 / 71.7s
    //   25% (5 workers)  — 91.6 / 98.5s
    // Both green, as were 4 workers at 116 / 124s. Throttling further costs
    // ~30% wall time and reproduced no flake in seven full runs, so this stays.
    // The two flakes were races in the tests themselves, not worker starvation:
    // a synchronous query chasing an async commit in upload-modal.test.tsx, and
    // the 5s default testTimeout below.
    maxWorkers: process.env.CI ? undefined : '50%',
    // Vitest's 5s default is tight for a jsdom component test driving a
    // multi-step userEvent flow while 10 sibling workers compete: InviteStaffModal's
    // 6-step invite reaches ~24s of file time under contention against ~14s idle,
    // and timed out mid-assertion. Raised for headroom, not to mask a hang — a
    // genuinely stuck test still fails, 10s later.
    testTimeout: 15_000,
    server: {
      deps: {
        inline: ['next-auth', 'next'],
      },
    },
    alias: {
      // `server-only` throws when loaded outside a React Server Component module
      // graph, which is every test in this jsdom suite. Individual files used to
      // stub it with vi.mock, but that boilerplate spreads to every TRANSITIVE
      // consumer — adding a server-only import to a shared module broke unrelated
      // action tests. Neutralising it here costs no safety: the real guard runs
      // at build time, where `next build` still fails on a client component that
      // imports server-only code.
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
      // Mirror the tsconfig path mappings. The more specific `@/generated`
      // mapping must come first so it wins over the catch-all `@` → src alias
      // (generated Prisma artifacts live at the repo root, not under src).
      '@/generated': path.resolve(__dirname, './generated'),
      '@/db': path.resolve(__dirname, './db'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
