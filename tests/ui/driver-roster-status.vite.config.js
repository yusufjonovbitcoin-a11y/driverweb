import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from './vite.config.js';
export default mergeConfig(base, {
  cacheDir: 'node_modules/.vite-driver-status-ui',
  resolve: { alias: [{ find: /^.*\/services\/driverSettingsService(?:\.js)?$/, replacement: fileURLToPath(new URL('./driver-roster-status.stub.js', import.meta.url)) }] },
});
