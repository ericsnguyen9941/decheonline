import { defineConfig } from 'vitest/config';

// The relay tests open real sockets; on a machine running many jobs a test or its teardown can take seconds.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
