import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During local development, proxy /api to `vercel dev` which runs on port 3000.
    // Run `npx vercel dev` in one terminal and `npm run dev:front` in another.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
