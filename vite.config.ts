import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      configPath: process.env.UPTIME_WRANGLER_CONFIG || 'wrangler.jsonc',
      persistState: process.env.UPTIME_PERSIST_PATH ? { path: process.env.UPTIME_PERSIST_PATH } : true,
    }),
  ],
  define: { __LOCAL_DEV__: JSON.stringify(command === 'serve') },
  server: { port: 5173, strictPort: true },
}));
