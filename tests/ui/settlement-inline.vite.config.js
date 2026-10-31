import { mergeConfig } from 'vite';
import base from '../../vite.config.js';
// Use the production PDF asset middleware, without loading any credentials.
export default mergeConfig(base, { envDir: false, cacheDir: 'node_modules/.vite-settlement-ui' });
