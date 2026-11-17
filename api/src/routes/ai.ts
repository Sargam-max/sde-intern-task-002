import { Hono } from 'hono'
import { ApiError } from '../lib/errors'
import type { AppEnv } from '../lib/types'
import { sniffType } from './attachments'

export const ai = new Hono<AppEnv>()

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * Resolves Gemini API key privately from server environment variables (c.env.GEMINI_API_KEY)
 * or optional request header.
 */
export function resolveGeminiKey(envKey?: string, headerKey?: string | null): string | null {
  if (headerKey === 'none') return null
  if (envKey?.trim()) return envKey.trim()
  if (headerKey?.trim()) return headerKey.trim()
  return null
}

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
  const apiKey = resolveGeminiKey(c.env.GEMINI_API_KEY, c.req.header('x-gemini-key'))
  return c.json({
    available: Boolean(apiKey),
    hasServerKey: Boolean(apiKey),
    model: 'gemini-2.5-flash',
  })
})

ai.get('/ai/status', (c) => {
  const apiKey = resolveGeminiKey(c.env.GEMINI_API_KEY, c.req.header('x-gemini-key'))
  return c.json({
    available: Boolean(apiKey),
    hasServerKey: Boolean(apiKey),
    model: 'gemini-2.5-flash',
  })
})

/** Parse a bill document (PDF or image) using Gemini multimodal AI vision */
const handleParseBill = async (c: import('hono').Context<AppEnv>) => {
  const apiKey = resolveGeminiKey(c.env.GEMINI_API_KEY, c.req.header('x-gemini-key'))

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
You are an expert financial document and utility bill parser with 100% precision.
Your goal is to extract the exact final payable amount from this bill without hallucination.

CRITICAL EXTRACTION RULES:
1. IDENTIFY THE TRUE PAYABLE AMOUNT:
   - Locate the final total or net payable amount for the current billing cycle (e.g. "Total Amount Due", "Net Payable", "Current Bill", "Total to Pay", "Grand Total", "Amount Due", "Net Amount Payable").
   - NEVER confuse the payable amount with:
     * Account numbers, Customer IDs, Meter numbers, or Invoice/Receipt numbers.
     * Present/Previous meter readings (e.g. 414, 404).
     * Consumption units (e.g. 10 cu.m., 120 kWh).
     * Tax ID / TIN numbers, phone numbers, or dates.
     * Subtotals, arrears (if already paid), or security deposits.
2. ON-TIME VS LATE PAYMENT:
   - If the bill shows both an on-time amount (e.g. "Total Amount Due: 210.00") and a penalty/after-due-date surcharge amount (e.g. "Amount after due date: 220.50"), ALWAYS extract the regular ON-TIME amount (210.00).
3. NO HALLUCINATIONS:
   - The payableAmount MUST be printed verbatim on the bill. Do NOT calculate, guess, or invent numbers that are not printed.
4. EXACT TITLE:
   - Identify the issuing organization or utility provider (e.g. "Buenavista Water District", "Airtel", "Tata Power", "BESCOM").

Output ONLY a JSON object:
{
  "title": "Vendor or utility name",
  "payableAmount": 210.00,
  "currency": "USD, INR, PHP, EUR, GBP, etc.",
  "dueDate": "YYYY-MM-DD or string if present",
  "lineText": "Exact line from bill where amount is printed",
  "explanation": "Why this is the payable amount"
}
`.trim()

  const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']
  let lastError: Error | null = null

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

      const makeRequest = async (useThinkingBudget = true) => {
        const generationConfig: Record<string, unknown> = {
          responseMimeType: 'application/json',
          temperature: 0.1,
        }
        if (useThinkingBudget && model.includes('2.5')) {
          generationConfig.thinkingConfig = { thinkingBudget: 0 }
        }

        return fetch(url, {
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
            generationConfig,
          }),
          signal: AbortSignal.timeout(15_000),
        })
      }

      let response = await makeRequest(true)
      if (!response.ok && response.status === 400) {
        // Fallback without thinkingConfig if model rejects thinkingBudget
        response = await makeRequest(false)
      }

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

      const parsed: GeminiParsedBill & { lineText?: string } = JSON.parse(cleaned)

      let totalCents: number | null = null
      const rawPayable =
        typeof parsed.payableAmount === 'number' && parsed.payableAmount > 0
          ? parsed.payableAmount
          : typeof parsed.payableAmount === 'string'
            ? Number.parseFloat(String(parsed.payableAmount).replace(/[^0-9.]/g, ''))
            : null

      if (rawPayable && !Number.isNaN(rawPayable) && rawPayable > 0) {
        totalCents = Math.round(rawPayable * 100)
      } else if (typeof parsed.totalCents === 'number' && parsed.totalCents > 0) {
        totalCents = Math.round(parsed.totalCents)
      }

      const lineDescription =
        parsed.lineText ||
        parsed.explanation ||
        `Gemini AI: ${parsed.title ?? 'Bill'} - ${parsed.currency ?? ''} ${parsed.payableAmount ?? ''}`

      const candidates = totalCents
        ? [{ cents: totalCents, line: lineDescription, score: 200 }]
        : []

      const formattedTitle = parsed.title
        ? /\b(bill|invoice)\b/i.test(parsed.title)
          ? parsed.title
          : `${parsed.title} bill`
        : null

      const formattedText = `[Gemini AI Backend Processed]\nProvider: ${parsed.title ?? 'Unknown'}\nPayable Amount: ${parsed.payableAmount ?? ''} ${parsed.currency ?? ''}\nDue Date: ${parsed.dueDate ?? 'N/A'}\nLine: ${parsed.lineText ?? ''}\nNote: ${parsed.explanation ?? ''}`

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
}

ai.post('/bills/parse', handleParseBill)
ai.post('/parse-bill', handleParseBill)
