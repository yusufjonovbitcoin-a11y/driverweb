import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { dirname, extname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

// Serve the exact installed PDF.js assets in development and emit the same
// files in production. Only manifest entries can be requested by the browser.
function pdfAssets() {
  const manifest = Promise.all(['cmaps', 'standard_fonts', 'wasm', 'iccs'].map(async (directory) => {
    const names = await readdir(resolve(pdfjsRoot, directory))
    return names.map((name) => [`pdfjs/${directory}/${name}`, resolve(pdfjsRoot, directory, name)])
  })).then((groups) => new Map(groups.flat()))
  return {
    name: 'pdfjs-local-assets',
    async configureServer(server) {
      const files = await manifest
      const base = server.config.base
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0]
        const file = path?.startsWith(base) && files.get(path.slice(base.length))
        if (!file) return next()
        try {
          const bytes = await readFile(file)
          response.setHeader('Content-Type', extname(file) === '.wasm' ? 'application/wasm' : 'application/octet-stream')
          response.setHeader('Cache-Control', 'public, max-age=3600')
          response.end(bytes)
        } catch (error) { next(error) }
      })
    },
    async generateBundle() {
      await Promise.all([...await manifest].map(async ([fileName, file]) => {
        this.emitFile({ type: 'asset', fileName, source: await readFile(file) })
      }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pdfAssets(),
  ],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api/vin-decode/': {
        target: 'https://vpic.nhtsa.dot.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/vin-decode\//, '/api/vehicles/DecodeVinValues/'),
      },
    },
  },
})
