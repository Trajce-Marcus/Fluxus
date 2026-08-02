import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Pinned, not vite's default-by-luck: the Console hardcodes this origin as
  // VITE_FLUXUS_RUNTIME_URL's dev fallback, so **Operations → Open** lands on a
  // dead port the moment vite increments past a busy 5173. strictPort fails the
  // start instead of drifting silently.
  server: { port: 5173, strictPort: true },
});
