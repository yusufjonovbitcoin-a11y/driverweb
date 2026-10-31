import { mergeConfig } from 'vite';import base from '../../vite.config.js';
export default mergeConfig(base,{envDir:false,build:{outDir:'output/security-build',emptyOutDir:false,rollupOptions:{input:'tests/ui/security.html'}}});
