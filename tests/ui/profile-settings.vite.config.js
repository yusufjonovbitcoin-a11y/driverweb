import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// Real credentials are never loaded into this local interaction fixture.
export default defineConfig({ envDir: false, plugins: [react(), tailwindcss()] });
