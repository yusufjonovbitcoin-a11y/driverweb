import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from './settlement-inline.vite.config.js';
export default mergeConfig(base, { cacheDir: 'node_modules/.vite-driver-documents-ui', resolve: { alias: [
  { find: /^.*\/services\/tripDocumentAccess\.js$/, replacement: fileURLToPath(new URL('./driver-documents-media.stub.js', import.meta.url)) },
] } });
