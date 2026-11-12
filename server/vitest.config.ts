import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several tests do real work (scrypt password hashing, SQLite export, VACUUM and import) and take
    // a second or two on a quiet machine. The 5 s default made them fail on a busy or slower one.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
