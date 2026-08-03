import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Fixed port so `npm run dev` (server + both apps concurrently) is
  // deterministic: the Runtime app pins 5173, the Console here. strictPort on
  // both — the Console links to the Runtime by hardcoded origin, so a silent
  // increment breaks the cross-app link rather than just moving a tab.
  server: { port: 5174, strictPort: true },
});
