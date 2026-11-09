import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // The shared .env lives at the repo root. Variables set in the shell take precedence.
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      proxy: {
        '/api': `http://127.0.0.1:${env.API_PORT ?? 3001}`,
      },
    },
    test: {
      environment: 'jsdom',
      css: false,
    },
  };
});
