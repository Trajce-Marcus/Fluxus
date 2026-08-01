import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Fixed port so `npm run dev` (server + both apps concurrently) is
  // deterministic: the Runtime app on 5173 (vite default), the Console here.
  server: { port: 5174 },
});
