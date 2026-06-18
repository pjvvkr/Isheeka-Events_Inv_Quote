import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Logic-flow tests (tests/**). These run the app's REAL lib functions against your
// LOCAL Supabase (.env → 127.0.0.1) and assert exact DB outcomes — so a failure
// pinpoints the broken calculation/transition, not just "something's off".
// jsdom gives a DOM so the toast/`notify` helpers don't blow up under Node.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{js,ts,jsx,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: true,
    // Run test FILES one at a time. They all authenticate as the same Supabase user,
    // and signOut() defaults to global scope (revokes tokens everywhere) — so parallel
    // files would yank each other's auth mid-run. Serial files = no auth race.
    fileParallelism: false,
  },
});
