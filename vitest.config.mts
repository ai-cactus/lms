import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [...defaultExclude, 'tests/e2e/**/*'],
    // Local dev boxes have many cores but comparatively little RAM per core.
    // Unbounded, vitest spawns one jsdom fork per core (22 here), which starved
    // React's act() timers, producing intermittent failures in Step2Modules /
    // InviteStaffModal / upload-modal / AddFacilityModal that all pass in
    // isolation — the reason pre-push was being bypassed with --no-verify.
    // Measured over 121 specs: unbounded = 30s wall / 229s environment with a
    // reproduced act() failure; 50% = 38s wall / 119s environment, green.
    // CI runners are 2-4 cores, where halving would be a real slowdown.
    maxWorkers: process.env.CI ? undefined : '50%',
    server: {
      deps: {
        inline: ['next-auth', 'next'],
      },
    },
    alias: {
      // Mirror the tsconfig path mappings. The more specific `@/generated`
      // mapping must come first so it wins over the catch-all `@` → src alias
      // (generated Prisma artifacts live at the repo root, not under src).
      '@/generated': path.resolve(__dirname, './generated'),
      '@/db': path.resolve(__dirname, './db'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
