import { createReadStream, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Serves the OCR engine (tesseract.js worker, its WebAssembly core and the English
 * language data) from this project under /ocr/, instead of letting the browser download
 * them from public CDNs. Bill reading then works offline and does not depend on a third
 * party being up. In dev the files are streamed from node_modules; in a build they are
 * copied into dist/ocr/.
 */
export function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const tesseract = dirname(require.resolve('tesseract.js/package.json'))
  const core = dirname(require.resolve('tesseract.js-core/package.json', { paths: [tesseract] }))
  const lang = dirname(require.resolve('@tesseract.js-data/eng/package.json'))

  // URL path -> file on disk. Worker picks based on browser WebAssembly capabilities.
  const files: Record<string, string> = {
    'ocr/worker.min.js': join(tesseract, 'dist/worker.min.js'),
    'ocr/core/tesseract-core-lstm.wasm.js': join(core, 'tesseract-core-lstm.wasm.js'),
    'ocr/core/tesseract-core-simd-lstm.wasm.js': join(core, 'tesseract-core-simd-lstm.wasm.js'),
    'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js': join(
      core,
      'tesseract-core-relaxedsimd-lstm.wasm.js',
    ),
    'ocr/core/tesseract-core.wasm.js': join(core, 'tesseract-core.wasm.js'),
    'ocr/core/tesseract-core-simd.wasm.js': join(core, 'tesseract-core-simd.wasm.js'),
    'ocr/core/tesseract-core-relaxedsimd.wasm.js': join(core, 'tesseract-core-relaxedsimd.wasm.js'),
    'ocr/lang/eng.traineddata.gz': join(lang, '4.0.0_best_int/eng.traineddata.gz'),
  }

  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]?.replace(/^\//, '') ?? ''
        const file = files[path]
        if (!file) return next()
        // Plain bytes: tesseract unzips the .gz itself, so no Content-Encoding header.
        res.setHeader(
          'content-type',
          path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
        )
        res.setHeader('cache-control', 'public, max-age=86400')
        createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) })
      }
    },
  }
}
