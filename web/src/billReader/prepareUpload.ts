import { checkUpload, MAX_UPLOAD_BYTES } from '../api'

const MAX_SIDE = 2000 // px: still sharp enough to read, far smaller than a phone photo

/**
 * Makes a file ready to store with the bill. Phone photos are often 3 to 8 MB, over the
 * 1 MB limit, so images that are too big are scaled down and saved as JPEG. PDFs cannot
 * be shrunk here, so a PDF over 1 MB returns an error message instead.
 */
export async function prepareUpload(
  file: File,
): Promise<{ file: File; error: null } | { file: null; error: string }> {
  const isImage =
    ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    /\.(png|jpe?g|webp)$/i.test(file.name)

  if (isImage && file.size > MAX_UPLOAD_BYTES) {
    try {
      const smaller = await shrinkImage(file)
      return { file: smaller, error: null }
    } catch {
      return { file: null, error: 'The photo is larger than 1 MB and could not be made smaller.' }
    }
  }

  const problem = checkUpload(file)
  return problem ? { file: null, error: problem } : { file, error: null }
}

async function shrinkImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (blob && blob.size <= MAX_UPLOAD_BYTES) {
      const name = file.name.replace(/\.[^.]+$/, '') || 'bill'
      return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
    }
  }
  throw new Error('still too large')
}
