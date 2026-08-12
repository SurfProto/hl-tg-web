import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { apiPlugin } from '../../scripts/vite-plugin-api';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  // apiPlugin serves the repo-root api/ functions from this dev server. Without
  // it every /api/* request falls through to the SPA fallback and returns
  // index.html, which is why local development could not exercise the app.
  plugins: [react(), apiPlugin({ root: repoRoot })],
  server: {
    host: true,
    port: 5173,
    fs: {
      // The api/ handlers import from packages/ and api/_lib, both outside this
      // app's root, so Vite has to be allowed to read the whole repo.
      allow: [repoRoot],
    },
  },
  resolve: {
    // Forces single React instance across all dependencies (pnpm-compatible)
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
