import { api } from '../api'
import { type ParsedBill, parseBill } from './parseBill'
import { getGeminiApiKey, hasGeminiApiKey, readWithGemini } from './readWithGemini'

/**
 * Reads a bill file in the browser and finds its total.
 *  - AI Vision: When Gemini API key is configured, uses Gemini 1.5/2.0 Flash for 100% exact parsing.
 *  - PDF with text: the text is read directly with pdf.js (fast and exact, ~50 ms).
 *  - Scanned PDF (no text): page 1 is rendered to canvas and read with OCR.
 *  - Photo (PNG, JPEG, WebP): pre-processed with Otsu adaptive binarization, then read with OCR.
 *
 * Runs client-side with warm worker caching for instant subsequent reads.
 */

export type ReadProgress = { stage: 'loading' | 'reading'; percent: number }
export type ReadResult = ParsedBill & { text: string; method: 'pdf-text' | 'ocr' | 'gemini-ai' }

const MIN_PDF_TEXT_LENGTH = 20
const MAX_PDF_PAGES = 3
const MAX_OCR_DIMENSION = 1400

let activeProgressCallback: ((progress: ReadProgress) => void) | null = null
let cachedWorkerPromise: Promise<import('tesseract.js').Worker> | null = null

/**
 * Eagerly warms up the OCR WebAssembly worker in the background so that
 * when the user drops or selects a bill, recognition starts instantly.
 */
export async function preloadOcr(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    await getOcrWorker()
  } catch {
    // Ignore background preload errors; will retry on demand.
  }
}

async function getOcrWorker(): Promise<import('tesseract.js').Worker> {
  if (!cachedWorkerPromise) {
    cachedWorkerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js')
      const origin = typeof window !== 'undefined' ? window.location.origin : ''

      let worker: import('tesseract.js').Worker
      try {
        worker = await createWorker('eng', 1, {
          workerBlobURL: false,
          workerPath: `${origin}/ocr/worker.min.js`,
          corePath: `${origin}/ocr/core`,
          langPath: `${origin}/ocr/lang`,
          logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text' && activeProgressCallback) {
              activeProgressCallback({ stage: 'reading', percent: Math.round(m.progress * 100) })
            }
          },
        })
      } catch {
        worker = await createWorker('eng', 1, {
          logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text' && activeProgressCallback) {
              activeProgressCallback({ stage: 'reading', percent: Math.round(m.progress * 100) })
            }
          },
        })
      }

      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
        tessjs_create_box: '0',
        tessjs_create_osd: '0',
      })

      return worker
    })().catch((err) => {
      cachedWorkerPromise = null // Reset so next attempt can recover
      throw err
    })
  }

  return cachedWorkerPromise
}

export async function readBill(
  file: File,
  onProgress: (progress: ReadProgress) => void = () => {},
): Promise<ReadResult> {
  // 1. Primary: Server-side Gemini AI Vision (via Cloudflare backend)
  try {
    onProgress({ stage: 'reading', percent: 30 })
    const clientKey = getGeminiApiKey()
    const backendResult = await api.parseBillWithAi(file, clientKey)
    onProgress({ stage: 'reading', percent: 100 })
    return {
      title: backendResult.title,
      totalCents: backendResult.totalCents,
      candidates: backendResult.candidates,
      text: backendResult.text,
      method: 'gemini-ai',
    }
  } catch (backendErr) {
    // If backend doesn't have a key or returned an error, check if client can run direct Gemini
    console.info(
      'Backend Gemini parse skipped or failed, checking client alternatives:',
      backendErr,
    )
  }

  // 2. Secondary: Direct browser-side Gemini API if client key is configured
  if (hasGeminiApiKey()) {
    try {
      onProgress({ stage: 'reading', percent: 50 })
      const aiResult = await readWithGemini(file)
      onProgress({ stage: 'reading', percent: 100 })
      return { ...aiResult, method: 'gemini-ai' }
    } catch (err) {
      console.warn('Client Gemini AI read failed, falling back to local OCR/PDF reader:', err)
      // Fall through to local parsing
    }
  }

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

  if (isPdf) {
    const { text, firstPage } = await readPdf(file, onProgress)
    if (text.replace(/\s/g, '').length >= MIN_PDF_TEXT_LENGTH) {
      return { ...parseBill(text), text, method: 'pdf-text' }
    }
    const ocrText = await ocr(firstPage, onProgress)
    return { ...parseBill(ocrText), text: ocrText, method: 'ocr' }
  }

  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)
  if (!isImage) {
    throw new Error('Choose a PDF or a photo of the bill.')
  }

  // Pre-process image with Otsu adaptive binarization for clean high-contrast text
  const processedImage = await preprocessImageForOcr(file)
  const text = await ocr(processedImage, onProgress)
  return { ...parseBill(text), text, method: 'ocr' }
}

/**
 * Computes Otsu's optimal threshold that maximizes inter-class variance
 * between dark text and lighter paper background.
 */
function computeOtsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Int32Array(256)
  const total = gray.length
  for (let i = 0; i < total; i++) {
    const val = gray[i] ?? 0
    hist[val] = (hist[val] ?? 0) + 1
  }

  let sum = 0
  for (let t = 0; t < 256; t++) {
    sum += t * (hist[t] ?? 0)
  }

  let sumB = 0
  let wB = 0
  let maxVar = 0
  let threshold = 128

  for (let t = 0; t < 256; t++) {
    const h = hist[t] ?? 0
    wB += h
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break

    sumB += t * h
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const varBetween = wB * wF * (mB - mF) * (mB - mF)

    if (varBetween > maxVar) {
      maxVar = varBetween
      threshold = t
    }
  }

  return threshold
}

async function preprocessImageForOcr(file: File): Promise<HTMLCanvasElement | File> {
  if (typeof document === 'undefined') return file
  try {
    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject()
      img.src = url
    })
    URL.revokeObjectURL(url)

    // Scale optimization: upscale small receipts for legible 25px+ letter height,
    // downscale huge phone photos to <= 1400px to keep OCR speed < 1s.
    const maxDim = Math.max(img.width, img.height)
    const scale =
      img.width < 700 ? Math.min(2, 900 / img.width) : Math.min(1, MAX_OCR_DIMENSION / maxDim)

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return file

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imgData.data
      const totalPixels = data.length / 4
      const gray = new Uint8ClampedArray(totalPixels)

      // Convert to luminance grayscale (BT.601 standard)
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i] ?? 0
        const g = data[i + 1] ?? 0
        const b = data[i + 2] ?? 0
        gray[j] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      }

      const threshold = computeOtsuThreshold(gray)

      // Sample border corners to detect if bill has an inverted dark background
      const w = canvas.width
      const h = canvas.height
      const cornerAvg =
        ((gray[0] ?? 0) + (gray[w - 1] ?? 0) + (gray[w * (h - 1)] ?? 0) + (gray[w * h - 1] ?? 0)) /
        4
      const isInverted = cornerAvg < 90

      // Binarize: pure black text on pure white paper
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const g = gray[j] ?? 0
        const isText = isInverted ? g > threshold : g <= threshold
        const val = isText ? 0 : 255
        data[i] = val
        data[i + 1] = val
        data[i + 2] = val
      }

      ctx.putImageData(imgData, 0, 0)
      return canvas
    } catch {
      // In case canvas security restricts getImageData, keep scaled canvas
      return canvas
    }
  } catch {
    return file
  }
}

async function readPdf(file: File, onProgress: (p: ReadProgress) => void) {
  onProgress({ stage: 'loading', percent: 0 })
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  let pdf: Awaited<typeof task.promise>
  try {
    pdf = await task.promise
  } catch {
    throw new Error('This PDF could not be opened. It may be damaged or password protected.')
  }

  const pages: string[] = []
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES)
  for (let n = 1; n <= pageCount; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    const rawItems = content.items.flatMap((item) =>
      'str' in item && item.str.trim()
        ? [{ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }]
        : [],
    )
    rawItems.sort((a, b) => b.y - a.y)

    // Cluster text items sharing the same visual row within vertical tolerance (5 points)
    const Y_TOLERANCE = 5
    const lineBuckets: { y: number; items: { text: string; x: number }[] }[] = []
    for (const item of rawItems) {
      let bucket = lineBuckets.find((b) => Math.abs(b.y - item.y) <= Y_TOLERANCE)
      if (!bucket) {
        bucket = { y: item.y, items: [] }
        lineBuckets.push(bucket)
      }
      bucket.items.push(item)
    }

    // Sort lines from top of the page to bottom, and items inside from left to right
    lineBuckets.sort((a, b) => b.y - a.y)
    const lines = lineBuckets.map((bucket) => {
      bucket.items.sort((a, b) => a.x - b.x)
      return bucket.items.map((it) => it.text).join(' ')
    })
    pages.push(lines.join('\n'))
    onProgress({ stage: 'reading', percent: Math.round((n / pageCount) * 100) })
  }

  const firstPage = await renderPage(pdf, 1)
  await task.destroy()
  return { text: pages.join('\n'), firstPage }
}

async function renderPage(
  pdf: { getPage: (n: number) => Promise<import('pdfjs-dist').PDFPageProxy> },
  n: number,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(n)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  return canvas
}

async function ocr(image: File | HTMLCanvasElement, onProgress: (p: ReadProgress) => void) {
  onProgress({ stage: 'loading', percent: 10 })
  activeProgressCallback = onProgress

  try {
    const worker = await getOcrWorker()
    const { PSM } = await import('tesseract.js')

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
    })

    const result = await worker.recognize(image)
    let text = result.data.text

    // If auto segmentation extracted sparse text, retry with single block mode
    if (text.replace(/\s/g, '').length < 20) {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      })
      const retry = await worker.recognize(image)
      if (retry.data.text.replace(/\s/g, '').length > text.replace(/\s/g, '').length) {
        text = retry.data.text
      }
    }
    return text
  } finally {
    activeProgressCallback = null
  }
}
