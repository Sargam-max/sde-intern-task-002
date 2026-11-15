import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { ocrAssets } from './ocrAssets.ts'

/**
 * Dev-server only. When the page's edge-case panel is on, requests carry an
 * `x-simulate` header and this middleware answers before the request reaches the API:
 *   slow    -> waits 3 s, then passes the request on
 *   timeout -> waits 15 s (longer than the page's 10 s timeout)
 *   error   -> answers 500 with a JSON error
 * It lets the video show the page surviving a broken API without changing the API code.
 * It does not exist in `vite build`, so production is unaffected.
 */
function simulateApiFailures(): Plugin {
  return {
    name: 'simulate-api-failures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const mode = req.headers['x-simulate']
        if (!req.url?.startsWith('/api') || typeof mode !== 'string') return next()

        if (mode === 'error') {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'simulated server error (dev only)' }))
          return
        }
        const delayMs = mode === 'slow' ? 3_000 : mode === 'timeout' ? 15_000 : 0
        setTimeout(next, delayMs)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    simulateApiFailures(),
    ocrAssets(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],
  // Prepare the bill-reading libraries when the dev server starts. Otherwise Vite finds
  // them the first time someone uploads a bill and reloads the page halfway through.
  optimizeDeps: {
    include: ['pdfjs-dist', 'tesseract.js'],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 127.0.0.1, not "localhost": on Windows, Node can resolve localhost to the IPv6
      // address ::1 while the API listens on IPv4, and the proxy then cannot connect.
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
