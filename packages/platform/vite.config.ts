import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Pinned like the other two apps (Runtime 5173, Console 5174) so
  // `npm run dev` is deterministic. strictPort: a silent increment would put
  // the platform plane on whatever port happened to be free, which is exactly
  // the surface that should never move around unannounced.
  server: { port: 5175, strictPort: true },
});
