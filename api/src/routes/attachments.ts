import { Hono } from 'hono'
import { ApiError, notFound } from '../lib/errors'
import type { AppEnv } from '../lib/types'

export const MAX_ATTACHMENT_BYTES = 1024 * 1024 // 1 MB

export type AttachmentInfo = {
  filename: string
  contentType: string
  sizeBytes: number
  uploadedAt: string
}

type AllowedType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'

/**
 * Works out the file type from its first bytes instead of trusting the name or the
 * Content-Type the browser sent. A renamed .exe or an HTML page is rejected.
 */
export function sniffType(bytes: Uint8Array): AllowedType | null {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((byte, i) => bytes[offset + i] === byte)

  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf' // %PDF-
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  // RIFF....WEBP
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  return null
}

/** Keeps a readable ASCII name (safe in a header) and drops path parts and quotes. */
function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(/[^A-Za-z0-9 ._()-]/g, '_')
    .trim()
    .slice(0, 200)
  return cleaned.length > 0 ? cleaned : 'bill'
}

export const attachments = new Hono<AppEnv>()

attachments.put('/bills/:billId/attachment', async (c) => {
  const db = c.env.DB
  const billId = c.req.param('billId')

  // Refuse big uploads before reading them into memory, when the size is known.
  const declared = Number(c.req.header('content-length') ?? '0')
  if (declared > MAX_ATTACHMENT_BYTES + 64 * 1024) {
    throw new ApiError(413, 'file is larger than 1 MB')
  }

  const bill = await db.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) throw notFound('bill')

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    throw new ApiError(400, 'send the file as multipart/form-data in a field called "file"')
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, 'a non-empty file is required in the "file" field')
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(413, 'file is larger than 1 MB')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = sniffType(bytes)
  if (!contentType) {
    throw new ApiError(415, 'only PDF, PNG, JPEG or WebP files are allowed')
  }

  const info: AttachmentInfo = {
    filename: cleanFilename(file.name),
    contentType,
    sizeBytes: bytes.byteLength,
    uploadedAt: new Date().toISOString(),
  }

  // Insert, or replace the old file. One statement, so a reader never sees half of it.
  await db
    .prepare(
      `INSERT INTO bill_attachments (bill_id, filename, content_type, size_bytes, data, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (bill_id) DO UPDATE SET
         filename = excluded.filename,
         content_type = excluded.content_type,
         size_bytes = excluded.size_bytes,
         data = excluded.data,
         uploaded_at = excluded.uploaded_at`,
    )
    .bind(billId, info.filename, info.contentType, info.sizeBytes, bytes, info.uploadedAt)
    .run()

  return c.json(info, 200)
})

attachments.get('/bills/:billId/attachment', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT filename, content_type, data FROM bill_attachments WHERE bill_id = ?',
  )
    .bind(c.req.param('billId'))
    .first<{ filename: string; content_type: string; data: ArrayBuffer | number[] }>()

  if (!row) throw notFound('attachment')

  const body = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data).buffer
  return c.body(body, 200, {
    'content-type': row.content_type,
    'content-disposition': `inline; filename="${row.filename}"`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
  })
})
