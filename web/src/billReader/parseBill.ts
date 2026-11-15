/**
 * Finds the amount to pay (and a likely title) in the text of a bill.
 *
 * The text comes from a PDF or from OCR of a photo, so it is noisy. The approach:
 *  1. clean OCR noise and normalize spaced decimals,
 *  2. find every money-looking value on every line,
 *  3. score each value by the words on its line ("amount due" beats "subtotal"),
 *  4. pick the best one, and keep the next best so the user can choose another.
 *
 * Pure function with no browser APIs, so it is unit tested in parseBill.test.ts.
 * The user always sees and can change the result before the bill is saved.
 */

export type AmountCandidate = {
  cents: number
  /** The line of the bill the value came from, shown to the user as evidence. */
  line: string
  score: number
}

export type ParsedBill = {
  totalCents: number | null
  candidates: AmountCandidate[]
  title: string | null
}

const MAX_CENTS = 99_999_999_999 // 999,999,999.99: anything bigger is not a household bill

// Higher score = more likely to be the amount to pay. Checked in order; first match wins.
const LINE_RULES: { pattern: RegExp; score: number }[] = [
  // Amounts that are about something else, or not the amount to pay now.
  { pattern: /\b(after|post)\s+(the\s+)?due\s+date\b|\blate\s+(fee|payment)/, score: 30 },
  {
    pattern:
      /\b(previous|last|prior)\s+(balance|bill|payment)|\bpayment\s+received|\bpaid\b|\bchange\b|\bcash\b|\btendered\b|\bdiscount|\bsaving/,
    score: 5,
  },
  { pattern: /\bsub\s*-?\s*total\b/, score: 20 },
  { pattern: /\b(tax|vat|gst|cgst|sgst|igst|cess)\b/, score: 10 },
  // Strongest indicators of the final amount to pay.
  {
    pattern:
      /\bgrand\s+total\b|\b(?:(?:total|current|net|final)\s+)?amount\s+(?:due|payable)\b|\b(?:total|balance|net|amt|payment|current)\s+(?:due|payable)\b|\b(?:total|current)\s+charges?\b|\bnew\s+balance\b|\bnet\s+amount\b|\bplease\s+pay\b|\bpay\s+this\s+amount\b|\b(?:amount|total)\s+to\s+pay\b|\bbill\s+(?:amount|total)\b|\binvoice\s+total\b|\btotal\s+amount\b|\bbalance\s+to\s+pay\b|\bamount\s*[:=]\s*\d|\btotal\s*[:=]\s*[$₹€£]?\s*\d/,
    score: 100,
  },
  { pattern: /\btotal\b|\bbalance\b|\bpayable\b/, score: 60 },
]

const KEYWORD_SCORE_FLOOR = 20 // a label at or above this may take its value from the next lines
const PLAIN_VALUE_SCORE = 1

// A number-looking token, with optional currency symbols in front or trailing.
// Handles $, ₹, €, £, Rs, INR, USD, EUR, GBP, and Indian notation "504/-".
const MONEY =
  /(?<![\w.,/-])((?:[$₹€£]|rs\.?|inr|usd|eur|gbp)\s*)?(\d(?:[\d.,]*\d)?)(?:\s*(?:[$₹€£]|rs\.?|inr|usd|eur|gbp|\/[-=]?|\/-))?(?![\w/-])/gi

/**
 * Turns "1,234.56", "1.234,56", "1,23,456.50", "123,45", "12.5" or "504" into cents.
 * The last "." or "," is a decimal point when 1 or 2 digits follow it, and a thousands
 * separator when 3 digits follow. Returns null for anything that does not read as money.
 */
export function parseAmountToken(token: string): { cents: number; hasDecimals: boolean } | null {
  const lastSep = Math.max(token.lastIndexOf('.'), token.lastIndexOf(','))
  let integerPart = token
  let fraction = ''
  if (lastSep !== -1) {
    const after = token.slice(lastSep + 1)
    if (after.length <= 2) {
      integerPart = token.slice(0, lastSep)
      fraction = after.padEnd(2, '0')
    } else if (after.length !== 3) {
      return null
    }
  }

  const separators = new Set(integerPart.replace(/\d/g, ''))
  if (separators.size > 1) return null
  if (separators.size === 1) {
    const groups = integerPart.split(/[.,]/)
    const western = groups.slice(1).every((g) => g.length === 3) && (groups[0]?.length ?? 0) <= 3
    const indian = /^\d{1,2}(?:[.,]\d{2})*[.,]\d{3}$/.test(integerPart)
    if (!western && !indian) return null
  }
  // A decimal separator must differ from the thousands separator ("1.234.56" is noise).
  if (fraction && separators.has(token.charAt(lastSep))) return null

  const units = Number(integerPart.replace(/[.,]/g, ''))
  const cents = units * 100 + (fraction ? Number(fraction) : 0)
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null
  return { cents, hasDecimals: fraction !== '' }
}

function scoreLine(line: string): number | null {
  const lower = line.toLowerCase()
  for (const rule of LINE_RULES) {
    if (rule.pattern.test(lower)) return rule.score
  }
  return null
}

function looksLikeDateOrTime(line: string): boolean {
  return /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/.test(line)
}

type MoneyValue = { cents: number; explicit: boolean }

/** Every money value on a line, in cents. `explicit` = had a currency sign or decimals. */
export function findMoney(line: string): MoneyValue[] {
  // Normalize OCR artifacts where decimal dots or commas have accidental whitespace: "504 . 00" -> "504.00"
  const cleaned = line.replace(/(\d+)\s+([.,])\s+(\d{1,2})\b/g, '$1$2$3')
  const values: MoneyValue[] = []
  for (const match of cleaned.matchAll(MONEY)) {
    const parsed = parseAmountToken(match[2] ?? '')
    if (parsed)
      values.push({
        cents: parsed.cents,
        explicit: Boolean(match[1]) || parsed.hasDecimals,
      })
  }
  return values
}

const BILL_TYPES: { pattern: RegExp; title: string }[] = [
  { pattern: /\belectric(ity)?\b|\bpower\b|\bkwh\b|\benergy\b/, title: 'Electricity' },
  { pattern: /\binternet\b|\bbroadband\b|\bwi-?fi\b|\bfib(er|re)\b/, title: 'Internet' },
  { pattern: /\bwater\b|\bsewer(age)?\b/, title: 'Water' },
  { pattern: /\bgas\b|\blpg\b/, title: 'Gas' },
  { pattern: /\bmobile\b|\bpostpaid\b|\btelephone\b/, title: 'Phone' },
  { pattern: /\brent\b|\blease\b/, title: 'Rent' },
  { pattern: /\bgrocer(y|ies)\b|\bsupermarket\b/, title: 'Groceries' },
  { pattern: /\brestaurant\b|\bcafe\b|\bdine\b/, title: 'Food' },
]

function guessTitle(lines: string[]): string | null {
  const all = lines.join(' ').toLowerCase()
  for (const type of BILL_TYPES) {
    if (type.pattern.test(all)) return `${type.title} bill`
  }
  // Otherwise the first line that reads like a name, usually the company at the top.
  const name = lines.find((line) => {
    const letters = line.replace(/[^\p{L}]/gu, '').length
    return letters >= 3 && letters / line.length > 0.6 && line.length <= 40
  })
  return name ? name.replace(/\s+/g, ' ').trim() : null
}

export function parseBill(text: string): ParsedBill {
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[|\][~—–]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0)

  const found: AmountCandidate[] = []

  lines.forEach((line, index) => {
    const lineScore = scoreLine(line)
    const hasStrongKeyword = lineScore !== null && lineScore >= 60
    const values =
      looksLikeDateOrTime(line) && !hasStrongKeyword
        ? findMoney(line).filter((v) => v.explicit)
        : findMoney(line)

    if (values.length > 0) {
      // A plain number on a line without any keyword is only kept if it looks like money.
      const usable = lineScore === null ? values.filter((v) => v.explicit) : values
      // The value at the end of a line is usually the amount ("Total ...... 41.20").
      const last = usable.at(-1)
      if (last) found.push({ cents: last.cents, line, score: lineScore ?? PLAIN_VALUE_SCORE })
      return
    }

    // "Amount due" on one line and "504" on subsequent lines (handling table cells and blank dividers)
    if (lineScore !== null && lineScore >= KEYWORD_SCORE_FLOOR) {
      for (let offset = 1; offset <= 4; offset++) {
        const next = lines[index + offset]
        if (!next) break
        // Skip empty lines or pure punctuation lines (e.g. ":", "-", "|")
        if (/^[:|\-_=.]+$/.test(next.trim())) continue
        const nextValues = findMoney(next)
        const lastVal = nextValues.at(-1)
        if (lastVal) {
          found.push({ cents: lastVal.cents, line: `${line} ${next}`, score: lineScore - offset })
          break
        }
      }
    }
  })

  // Best first: higher score, then the larger amount (a total is never below its parts).
  found.sort((a, b) => b.score - a.score || b.cents - a.cents)

  const seen = new Set<number>()
  const candidates = found.filter((c) => !seen.has(c.cents) && seen.add(c.cents)).slice(0, 5)

  return {
    totalCents: candidates[0]?.cents ?? null,
    candidates,
    title: guessTitle(lines),
  }
}
