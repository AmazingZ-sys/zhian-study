import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';
const webRequire = createRequire(new URL('./apps/web/package.json', import.meta.url));
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { vue: webRequire.resolve('vue') } },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
