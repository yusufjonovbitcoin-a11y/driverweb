import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  // Do not load .env credentials into the synthetic fixture bundle.
  envDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: [{ find: /^.*\/services\/operationsService(?:\.js)?$/, replacement: fileURLToPath(new URL('./operations.stub.js', import.meta.url)) }] },
});
