import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const fixture = name => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  envDir: false, plugins: [react(), tailwindcss()],
  resolve: { alias: [
    { find: /^.*\/services\/staffLoadDocumentService\.js$/, replacement: fixture('./document-workspace.stub.js') },
    { find: /^.*\/services\/tripDocumentAccess\.js$/, replacement: fixture('./document-workspace-media.stub.js') },
  ] },
});
