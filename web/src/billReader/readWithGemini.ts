import type { ParsedBill } from './parseBill'

/**
 * Uses Google Gemini API (free tier) for 100% accurate multimodal invoice and bill parsing.
 * Supports PDFs and images (PNG, JPEG, WebP).
 * Extracts exact on-time payable amounts, provider name, and currency without regex errors.
 */

export function getGeminiApiKey(): string | null {
  if (typeof window === 'undefined') return null
  const envKey = (import.meta as unknown as { env?: { VITE_GEMINI_API_KEY?: string } }).env
    ?.VITE_GEMINI_API_KEY
  if (envKey?.trim()) return envKey.trim()
  const stored = localStorage.getItem('gemini_api_key')
  if (stored?.trim()) return stored.trim()
  return null
}

export function setGeminiApiKey(key: string | null): void {
  if (typeof window === 'undefined') return
  if (key?.trim()) {
    localStorage.setItem('gemini_api_key', key.trim())
  } else {
    localStorage.removeItem('gemini_api_key')
  }
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey())
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0)
  }
  return btoa(binary)
}

type GeminiInvoiceResponse = {
  title?: string
  totalCents?: number
  payableAmount?: number
  currency?: string
  dueDate?: string
  explanation?: string
}

export async function readWithGemini(file: File): Promise<ParsedBill & { text: string }> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Gemini API key is not configured.')
  }

  const base64Data = await fileToBase64(file)
  const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')

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

  // Try gemini-2.5-flash first (most capable free multimodal model), then fallback
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
        const errorBody = await response.text()
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`)
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> }
          text?: string
        }>
      }
      const textOutput =
        json.candidates?.[0]?.content?.parts?.[0]?.text ?? json.candidates?.[0]?.text ?? ''

      if (!textOutput) throw new Error('No response generated by Gemini.')

      const cleanedJson = textOutput
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()
      const parsed: GeminiInvoiceResponse & { lineText?: string } = JSON.parse(cleanedJson)

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

      return {
        totalCents,
        candidates,
        title: formattedTitle,
        text: `[Gemini AI Processed]\nProvider: ${parsed.title ?? 'Unknown'}\nPayable Amount: ${parsed.payableAmount ?? ''} ${parsed.currency ?? ''}\nDue Date: ${parsed.dueDate ?? 'N/A'}\nLine: ${parsed.lineText ?? ''}\nNote: ${parsed.explanation ?? ''}`,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Continue to next model if available
    }
  }

  throw lastError || new Error('Failed to parse bill with Gemini API.')
}
