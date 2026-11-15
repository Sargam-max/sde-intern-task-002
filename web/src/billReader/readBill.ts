import { type ParsedBill, parseBill } from './parseBill'

/**
 * Reads a bill file in the browser and finds its total.
 *  - PDF with text: the text is read directly with pdf.js (fast and exact).
 *  - Scanned PDF (no text): page 1 is drawn to a canvas and read with OCR.
 *  - Photo (PNG, JPEG, WebP): read with OCR (tesseract.js).
 * Nothing is sent to a third party; the OCR files are served by this app (ocrAssets.ts).
 * The heavy libraries are only downloaded the first time someone reads a bill.
 */

export type ReadProgress = { stage: 'loading' | 'reading'; percent: number }
export type ReadResult = ParsedBill & { text: string; method: 'pdf-text' | 'ocr' }

const MIN_PDF_TEXT_LENGTH = 20 // less than this means a scanned PDF with no real text
const MAX_PDF_PAGES = 3

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
  const text = await ocr(file, onProgress)
  return { ...parseBill(text), text, method: 'ocr' }
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
    // Rebuild lines from the position of each piece of text (top to bottom, left to right).
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

  // Keep page 1 as an image in case the PDF turns out to be a scan.
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
  const origin = window.location.origin
  const worker = await createWorker('eng', 1, {
    workerPath: `${origin}/ocr/worker.min.js`,
    corePath: `${origin}/ocr/core`,
    langPath: `${origin}/ocr/lang`,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress({ stage: 'reading', percent: Math.round(m.progress * 100) })
      }
    },
  })
  try {
    // Explicitly set PSM.AUTO so Tesseract scans the whole page including tables, boxes, and columns.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
    })
    const result = await worker.recognize(image)
    let text = result.data.text
    // If auto segmentation extracted no readable text, retry with sparse text mode.
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
    await worker.terminate()
  }
}
