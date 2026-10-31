import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from './vite.config.js';
export default mergeConfig(base, {
  cacheDir: 'node_modules/.vite-chat-reliability',
  resolve: { alias: [{ find: /^.*\/services\/chatService(?:\.js)?$/, replacement: fileURLToPath(new URL('./chat-reliability.stub.js', import.meta.url)) }] },
});
