/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
// @ts-expect-error — plain ESM helper shared with deployment tooling
import { contentSecurityPolicy, headersFile, securityHeaders } from './scripts/security-headers.mjs';

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

  /**
   * Production security headers. The build gets a CSP <meta> (works on any
   * static host) and a `_headers` file with the full header set (incl.
   * frame-ancestors, which only works as a header). Dev mode is excluded
   * because Vite's HMR needs inline scripts.
   */
  function securityHeadersPlugin(supabaseUrl: string | undefined): Plugin {
    return {
      name: 'tradepilot:security-headers',
      apply: 'build',
      transformIndexHtml() {
        if (!supabaseUrl) return [];
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(supabaseUrl, { forMeta: true }) }, injectTo: 'head-prepend' }];
      },
      generateBundle() {
        if (supabaseUrl) this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(supabaseUrl) });
      },
    };
  }

  export default defineConfig(({ mode }) => {
    const supabaseUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL;
    return {
    plugins: [guardPublicEnv(), securityHeadersPlugin(supabaseUrl), react(), tailwindcss()],
    preview: { headers: supabaseUrl ? securityHeaders(supabaseUrl) : {} },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          // Recharts gets its own chunk; all other vendor code shares one. Splitting
          // React/Radix/data libraries into several chunks produced a cycle that broke
          // the production bundle ("reading 'forwardRef' of undefined"), which the
          // dev server never shows. tests/e2e/csp.spec.ts runs the real build.
          manualChunks(id) {
            if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) return 'charts';
            // Everything else from node_modules in ONE chunk: a single vendor
            // chunk cannot form the cross-chunk cycle described above.
            if (id.includes('node_modules')) return 'vendor';
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
  };
});
