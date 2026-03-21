import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
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
