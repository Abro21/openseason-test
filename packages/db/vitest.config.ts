import { defineConfig } from 'vitest/config';

// DB tests share one local database, so files run one at a time.
export default defineConfig({ test: { fileParallelism: false, testTimeout: 20000, hookTimeout: 30000 } });
