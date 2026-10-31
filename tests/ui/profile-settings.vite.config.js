import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
// Real credentials are never loaded into this local interaction fixture.
export default defineConfig({ envDir: false, cacheDir: 'node_modules/.vite-profile-settings', plugins: [react(), tailwindcss()], resolve: { alias: [
  { find: /^.*\/lib\/supabase(?:\.js)?$/, replacement: fileURLToPath(new URL('./profile-auth.stub.js', import.meta.url)) },
  { find: /^.*\/services\/(?:operationsService|driverSettingsService)(?:\.js)?$/, replacement: fileURLToPath(new URL('./profile-services.stub.js', import.meta.url)) },
] } });
