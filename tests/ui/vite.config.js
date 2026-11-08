import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  // Do not load .env credentials into the synthetic fixture bundle.
  envDir: false,
  cacheDir: 'node_modules/.vite-workspace-ui',
  plugins: [react(), tailwindcss(), {
    name: 'synthetic-workspace-auth',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer?.replaceAll('\\', '/').endsWith('/src/App.jsx')) return;
      if (['./hooks/useAuth', './lib/supabase', './services/chatService'].includes(source)) {
        return fileURLToPath(new URL('./workspace-route.stub.js', import.meta.url));
      }
    },
  }],
  resolve: { alias: [{ find: /^.*\/services\/operationsService(?:\.js)?$/, replacement: fileURLToPath(new URL('./operations.stub.js', import.meta.url)) }] },
});
