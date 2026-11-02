import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const SERVER_PORT = Number(process.env.MS_PORT ?? 8787);

export default defineConfig(({ mode }) => {
  /** claude.ai 페이지로 올리는 빌드: 서버 없이 AI 대전만, 파일 하나로 묶는다 (tools/artifact.mjs) */
  const artifact = mode === 'artifact';
  return {
    root: 'src/client',
    publicDir: artifact ? false : '../../public',
    base: './',
    resolve: artifact
      ? { alias: [{ find: /^\.\/fonts$/, replacement: fileURLToPath(new URL('./src/client/fonts-cdn.ts', import.meta.url)) }] }
      : {},
    envDir: '../..',
    build: {
      outDir: artifact ? '../../dist-artifact' : '../../dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
      ...(artifact
        ? {
            assetsInlineLimit: 100_000_000,
            cssCodeSplit: false,
            modulePreload: false,
            rollupOptions: { output: { inlineDynamicImports: true } },
          }
        : {}),
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
  };
});
