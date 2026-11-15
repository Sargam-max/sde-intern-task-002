import { Hono } from 'hono'
import { ApiError } from '../lib/errors'
import type { AppEnv } from '../lib/types'
import { sniffType } from './attachments'

export const ai = new Hono<AppEnv>()

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB

type GeminiParsedBill = {
  title?: string
  totalCents?: number
  payableAmount?: number
  currency?: string
  dueDate?: string
  explanation?: string
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0)
  }
  return btoa(binary)
}

/** Check if Gemini API key is configured on server */
ai.get('/bills/ai-status', (c) => {
  const serverKey = c.env.GEMINI_API_KEY?.trim()
  return c.json({
    available: Boolean(serverKey),
    hasServerKey: Boolean(serverKey),
    model: 'gemini-2.5-flash',
  })
})

/** Parse a bill document (PDF or image) using Gemini multimodal AI vision */
ai.post('/bills/parse', async (c) => {
  const serverKey = c.env.GEMINI_API_KEY?.trim()
  const headerKey = c.req.header('x-gemini-key')?.trim()
  const apiKey = serverKey || headerKey

  if (!apiKey) {
    throw new ApiError(
      400,
      'Gemini API key is not configured on the backend (GEMINI_API_KEY) or in the X-Gemini-Key header.',
    )
  }

  let base64Data = ''
  let mimeType = 'application/pdf'

  const contentTypeHeader = c.req.header('content-type') || ''

  if (contentTypeHeader.includes('multipart/form-data')) {
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      throw new ApiError(400, 'Invalid multipart/form-data payload.')
    }

    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError(400, 'A non-empty file is required in the "file" field.')
    }

    if (file.size > MAX_FILE_BYTES) {
      throw new ApiError(413, 'File is larger than 5 MB.')
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detectedType = sniffType(bytes)
    if (!detectedType) {
      // Check file extension / reported type before rejecting
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        mimeType = 'application/pdf'
      } else if (file.type.startsWith('image/')) {
        mimeType = file.type
      } else {
        throw new ApiError(415, 'Only PDF, PNG, JPEG or WebP files are allowed.')
      }
    } else {
      mimeType = detectedType
    }

    base64Data = bytesToBase64(bytes)
  } else if (contentTypeHeader.includes('application/json')) {
    const body = (await c.req.json().catch(() => null)) as {
      fileBase64?: string
      mimeType?: string
    } | null

    if (!body?.fileBase64) {
      throw new ApiError(400, 'Missing "fileBase64" in JSON request.')
    }

    base64Data = body.fileBase64
    mimeType = body.mimeType || 'application/pdf'
  } else {
    throw new ApiError(400, 'Expected multipart/form-data or application/json.')
  }

  const prompt = `
Analyze this bill or invoice document carefully and extract the financial information.
Return a valid JSON object matching this schema:
{
  "title": "A short descriptive name of the utility or vendor (e.g. BESCOM Electricity, Airtel Wi-Fi, Water Board, FreshMart)",
  "totalCents": (integer cents to be paid right now, e.g. 1475.00 becomes 147500. CRITICAL: If there is an on-time payable amount and an after-due-date late fee amount, ALWAYS choose the regular on-time payable amount),
  "payableAmount": (float amount, e.g. 1475.00),
  "currency": "USD, INR, EUR, GBP, etc.",
  "dueDate": "YYYY-MM-DD or string if present",
  "explanation": "Short line explaining where the amount came from"
}
Only output the JSON object, nothing else.
`.trim()

  const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']
  let lastError: Error | null = null

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Gemini API error (${response.status}): ${errorText}`)
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> }
          text?: string
        }>
      }

      const textOutput =
        json.candidates?.[0]?.content?.parts?.[0]?.text ?? json.candidates?.[0]?.text ?? ''

      if (!textOutput) {
        throw new Error('No content returned from Gemini model.')
      }

      const cleaned = textOutput
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()

      const parsed: GeminiParsedBill = JSON.parse(cleaned)

      let totalCents: number | null = null
      if (typeof parsed.totalCents === 'number' && parsed.totalCents > 0) {
        totalCents = Math.round(parsed.totalCents)
      } else if (typeof parsed.payableAmount === 'number' && parsed.payableAmount > 0) {
        totalCents = Math.round(parsed.payableAmount * 100)
      }

      const lineDescription =
        parsed.explanation ||
        `Gemini AI: ${parsed.title ?? 'Bill'} - ${parsed.currency ?? ''} ${parsed.payableAmount ?? ''}`

      const candidates = totalCents
        ? [{ cents: totalCents, line: lineDescription, score: 200 }]
        : []

      const formattedTitle = parsed.title ? `${parsed.title} bill` : null
      const formattedText = `[Gemini AI Backend Processed]\nProvider: ${parsed.title ?? 'Unknown'}\nPayable Amount: ${parsed.payableAmount ?? ''} ${parsed.currency ?? ''}\nDue Date: ${parsed.dueDate ?? 'N/A'}\nNote: ${parsed.explanation ?? ''}`

      return c.json(
        {
          ok: true,
          data: {
            title: formattedTitle,
            totalCents,
            payableAmount: parsed.payableAmount ?? (totalCents ? totalCents / 100 : null),
            currency: parsed.currency ?? 'USD',
            dueDate: parsed.dueDate ?? null,
            explanation: parsed.explanation ?? null,
            candidates,
            text: formattedText,
          },
        },
        200,
      )
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw new ApiError(
    502,
    `Failed to parse bill with Gemini: ${lastError?.message || 'Unknown error'}`,
  )
})
