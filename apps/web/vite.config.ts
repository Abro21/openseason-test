/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // PGlite ships its own WebAssembly and data files; pre-bundling would break their URLs.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { target: 'es2022' },
  test: { environment: 'jsdom', include: ['src/**/*.test.tsx', 'src/**/*.test.ts'] },
});
