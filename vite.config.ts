import { defineConfig } from 'vitest/config';

const SERVER_PORT = Number(process.env.MS_PORT ?? 8787);

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: { '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true } },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
