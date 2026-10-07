import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: process.env.PAGES_BASE_PATH || './',
  server: { port: 5173 },
  build: { sourcemap: false },
});
