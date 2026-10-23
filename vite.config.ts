/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Refuse to build if a privileged credential would be exposed to the browser.
 * Only VITE_-prefixed variables are bundled, so those are the ones checked.
 */
function guardPublicEnv(): Plugin {
  return {
    name: 'tradepilot:guard-public-env',
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      for (const [name, value] of Object.entries(env)) {
        const role = (() => {
          try {
            return JSON.parse(Buffer.from(value.split('.')[1] ?? '', 'base64url').toString()).role;
          } catch {
            return undefined;
          }
        })();
        if (/SERVICE_ROLE|SECRET/i.test(name) || value.startsWith('sb_secret_') || role === 'service_role') {
          throw new Error(`${name} looks like a privileged key. Privileged keys must never be exposed to the browser; use the publishable/anon key.`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [guardPublicEnv(), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split stable vendor code into long-cacheable chunks.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) return 'charts';
          if (/[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion';
          if (/[\\/](@radix-ui|radix-ui|@floating-ui)[\\/]/.test(id)) return 'radix';
          if (/[\\/](@supabase|@tanstack|zod)[\\/]/.test(id)) return 'data';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
