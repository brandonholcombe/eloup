import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig.json sets jsx="preserve" for Next.js. Vitest uses esbuild,
  // which respects only its own jsx setting — set "automatic" so TSX
  // components imported by .test.ts files can render via the React 17+
  // automatic runtime (no `import React from 'react'` required in
  // every component file).
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname,
    },
  },
});
