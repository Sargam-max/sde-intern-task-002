// Tests for uploading a bill file. Written for this solution, not part of the visible tests.
import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { sniffType } from '../src/routes/attachments'
import { type Bill, call, createBill, createHome } from './helpers'

const PDF = new TextEncoder().encode('%PDF-1.4\n% test bill\n')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')

function upload(billId: string, bytes: Uint8Array, name = 'bill.pdf', type = 'application/pdf') {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  return exports.default.fetch(
    new Request(`http://localhost/api/bills/${billId}/attachment`, { method: 'PUT', body: form }),
  )
}

function download(billId: string) {
  return exports.default.fetch(new Request(`http://localhost/api/bills/${billId}/attachment`))
}

async function newBill() {
  const { homeId } = await createHome(['Asha', 'Ben'])
  const bill = await createBill(homeId, 1000)
  return { homeId, billId: bill.body.id }
}

describe('bill upload', () => {
  it('stores a PDF and gives back the same bytes', async () => {
    const { billId } = await newBill()

    const res = await upload(billId, PDF)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      filename: 'bill.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.byteLength,
    })

    const file = await download(billId)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF)
  })

  it('replaces the old file when a new one is uploaded', async () => {
    const { billId } = await newBill()
    await upload(billId, PDF)

    await upload(billId, PNG, 'photo.png', 'image/png')

    const file = await download(billId)
    expect(file.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG)
  })

  it('shows the file details in the bill list, but not in the create response', async () => {
    const { homeId } = await createHome(['Asha'])
    const created = await createBill(homeId, 500)
    expect(created.body).not.toHaveProperty('attachment')
    await upload(created.body.id, PDF, 'march electricity.pdf')

    const list = await call<{ bills: (Bill & { attachment: { filename: string } | null })[] }>(
      'GET',
      `/api/homes/${homeId}/bills`,
    )

    expect(list.body.bills[0]?.attachment?.filename).toBe('march electricity.pdf')
  })

  it('checks the real file type, not the name: an HTML page called .pdf is rejected', async () => {
    const { billId } = await newBill()
    const res = await upload(billId, HTML, 'bill.pdf', 'application/pdf')
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  it('rejects a file larger than 1 MB', async () => {
    const { billId } = await newBill()
    const big = new Uint8Array(1024 * 1024 + 1)
    big.set(PDF)
    expect((await upload(billId, big)).status).toBe(413)
  })

  it('rejects an upload with no file', async () => {
    const { billId } = await newBill()
    const res = await exports.default.fetch(
      new Request(`http://localhost/api/bills/${billId}/attachment`, {
        method: 'PUT',
        body: new FormData(),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for a bill that does not exist, and for a bill with no file', async () => {
    expect((await upload('does-not-exist', PDF)).status).toBe(404)
    const { billId } = await newBill()
    const missing = await download(billId)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: expect.any(String) })
  })

  it('removes path parts and odd characters from the file name', async () => {
    const { billId } = await newBill()
    const res = await upload(billId, PDF, '..\\..\\secret*bill.pdf')
    const info: { filename: string } = await res.json()
    expect(info.filename).toBe('secret_bill.pdf')
  })
})

describe('sniffType', () => {
  it('recognises the allowed types by their first bytes', () => {
    expect(sniffType(PDF)).toBe('application/pdf')
    expect(sniffType(PNG)).toBe('image/png')
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffType(HTML)).toBeNull()
    expect(sniffType(new Uint8Array())).toBeNull()
  })
})
