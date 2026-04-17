import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    exclude: [...defaultExclude, 'tests/e2e/**/*'],
    server: {
      deps: {
        inline: ['next-auth', 'next'],
      },
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
