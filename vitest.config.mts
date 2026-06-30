import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [...defaultExclude, 'tests/e2e/**/*'],
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
