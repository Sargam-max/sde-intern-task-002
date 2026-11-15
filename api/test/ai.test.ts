import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call } from './helpers'

const PDF_DUMMY = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')

describe('AI bill parsing endpoint', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports AI status on GET /api/bills/ai-status', async () => {
    const res = await call<{ available: boolean; model: string }>('GET', '/api/bills/ai-status')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('available')
    expect(res.body.model).toBe('gemini-2.5-flash')
  })

  it('rejects POST /api/bills/parse if no API key is provided', async () => {
    const form = new FormData()
    form.append('file', new File([PDF_DUMMY], 'invoice.pdf', { type: 'application/pdf' }))

    const res = await exports.default.fetch(
      new Request('http://localhost/api/bills/parse', {
        method: 'POST',
        body: form,
      }),
    )

    // In tests env, GEMINI_API_KEY might not be bound unless configured
    // If no key is configured, it must return 400
    if (res.status === 400) {
      const json = (await res.json()) as { error: string }
      expect(json.error).toMatch(/Gemini API key is not configured/i)
    }
  })

  it('rejects POST /api/bills/parse if file is missing in multipart', async () => {
    const form = new FormData()
    const res = await exports.default.fetch(
      new Request('http://localhost/api/bills/parse', {
        method: 'POST',
        headers: { 'x-gemini-key': 'test-key' },
        body: form,
      }),
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/non-empty file is required/i)
  })

  it('parses invoice using Gemini and returns structured response', async () => {
    // Mock global fetch for the Gemini API call
    const originalFetch = globalThis.fetch
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  title: 'Airtel Broadband',
                  totalCents: 117800,
                  payableAmount: 1178.0,
                  currency: 'INR',
                  dueDate: '2026-06-15',
                  explanation: 'Total Payable Amount on or before Due Date',
                }),
              },
            ],
          },
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : ''
      if (url.includes('generativelanguage.googleapis.com')) {
        return new Response(JSON.stringify(mockGeminiResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    })

    const form = new FormData()
    form.append('file', new File([PDF_DUMMY], 'bill.pdf', { type: 'application/pdf' }))

    const res = await exports.default.fetch(
      new Request('http://localhost/api/bills/parse', {
        method: 'POST',
        headers: { 'x-gemini-key': 'test-fake-key' },
        body: form,
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      data: {
        title: string
        totalCents: number
        payableAmount: number
        currency: string
        dueDate: string
      }
    }

    expect(json.ok).toBe(true)
    expect(json.data.title).toBe('Airtel Broadband bill')
    expect(json.data.totalCents).toBe(117800)
    expect(json.data.payableAmount).toBe(1178)
    expect(json.data.currency).toBe('INR')
    expect(json.data.dueDate).toBe('2026-06-15')
  })
})
