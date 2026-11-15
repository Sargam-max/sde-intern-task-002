import { type ParsedBill, parseBill } from './parseBill'

/**
 * Reads a bill file in the browser and finds its total.
 *  - PDF with text: the text is read directly with pdf.js (fast and exact).
 *  - Scanned PDF (no text): page 1 is drawn to a canvas and read with OCR.
 *  - Photo (PNG, JPEG, WebP): pre-processed for contrast, then read with OCR (tesseract.js).
 * Runs client-side in WebAssembly with fallback for maximum reliability.
 */

export type ReadProgress = { stage: 'loading' | 'reading'; percent: number }
export type ReadResult = ParsedBill & { text: string; method: 'pdf-text' | 'ocr' }

const MIN_PDF_TEXT_LENGTH = 20
const MAX_PDF_PAGES = 3
const MAX_OCR_DIMENSION = 1800 // px: optimal balance for Tesseract WASM accuracy & speed

export async function readBill(
  file: File,
  onProgress: (progress: ReadProgress) => void = () => {},
): Promise<ReadResult> {
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

  // Pre-process image to scale down extreme 4K resolutions and boost text contrast
  const processedImage = await preprocessImageForOcr(file)
  const text = await ocr(processedImage, onProgress)
  return { ...parseBill(text), text, method: 'ocr' }
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

    const scale = Math.min(1, MAX_OCR_DIMENSION / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    // Draw base image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    // Contrast boost: helps faint utility receipts, red ink, and colored background receipts
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imgData.data
      for (let i = 0; i < data.length; i += 4) {
        // Luminance calculation
        const r = data[i] ?? 0
        const g = data[i + 1] ?? 0
        const b = data[i + 2] ?? 0
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        // High-contrast stretch
        const contrast = gray < 128 ? gray * 0.75 : Math.min(255, gray * 1.15)
        data[i] = contrast
        data[i + 1] = contrast
        data[i + 2] = contrast
      }
      ctx.putImageData(imgData, 0, 0)
    } catch {
      // If canvas security restricts getImageData, keep unmodified scaled canvas
    }

    return canvas
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
    const items = content.items.flatMap((item) =>
      'str' in item && item.str.trim()
        ? [{ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }]
        : [],
    )
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: string[] = []
    let lastY: number | null = null
    for (const item of items) {
      if (lastY === null || Math.abs(item.y - lastY) > 3) lines.push(item.text)
      else lines[lines.length - 1] += ` ${item.text}`
      lastY = item.y
    }
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
  onProgress({ stage: 'loading', percent: 0 })
  const { createWorker, PSM } = await import('tesseract.js')
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null

  // Try local offline WASM bundle first, with auto-fallback to CDN
  try {
    worker = await createWorker('eng', 1, {
      workerBlobURL: false,
      workerPath: `${origin}/ocr/worker.min.js`,
      corePath: `${origin}/ocr/core`,
      langPath: `${origin}/ocr/lang`,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') {
          onProgress({ stage: 'reading', percent: Math.round(m.progress * 100) })
        }
      },
    })
  } catch {
    // If local worker fails (e.g. strict CSP / file server edge cases), initialize standard worker
    worker = await createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') {
          onProgress({ stage: 'reading', percent: Math.round(m.progress * 100) })
        }
      },
    })
  }

  try {
    // Mode 3 (PSM.AUTO): analyzes tables, columns, and boxed receipts
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
    })
    const result = await worker.recognize(image)
    let text = result.data.text

    // If auto segmentation extracted no readable text, retry with sparse text mode
    if (text.replace(/\s/g, '').length < 20) {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      })
      const retry = await worker.recognize(image)
      if (retry.data.text.replace(/\s/g, '').length > text.replace(/\s/g, '').length) {
        text = retry.data.text
      }
    }
    return text
  } finally {
    if (worker) {
      await worker.terminate()
    }
  }
}
