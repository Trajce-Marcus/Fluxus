import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@wql/types':   path.resolve(__dirname, '../wql-types/src'),
      '@wql/runtime': path.resolve(__dirname, '../wql-runtime/src'),
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
});
