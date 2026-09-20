import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// `base` is overridable so the same build works at a domain root, under an
// Azure Static Web Apps route, or in a sub-path on an internal server.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    // mcp/ is a separate package with its own node:test suite (npm test in that folder).
    exclude: ['**/node_modules/**', '**/dist/**', 'mcp/**'],
  },
});
