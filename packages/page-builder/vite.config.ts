import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Fixed port so `npm run dev` (server + both hosts concurrently) is
  // deterministic: sdm on 5173 (vite default), page builder here.
  server: { port: 5174 },
});
