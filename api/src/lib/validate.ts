import type { Context } from 'hono'
import { ApiError, invalid } from './errors'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the request body. Bad JSON is a 400, a body that is not an object is a 422. */
export async function readJsonObject(c: Context): Promise<JsonObject> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ApiError(400, 'request body must be valid JSON')
  }
  if (!isObject(body)) {
    throw invalid('request body must be a JSON object')
  }
  return body
}

/** A trimmed, non-empty string of at most `maxLength` characters. */
export function requireText(body: JsonObject, field: string, maxLength: number): string {
  const value = body[field]
  if (typeof value !== 'string') {
    throw invalid(`${field} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw invalid(`${field} must not be empty`)
  }
  if (trimmed.length > maxLength) {
    throw invalid(`${field} must be at most ${maxLength} characters`)
  }
  return trimmed
}

/** A whole number of cents greater than zero. Rejects decimals, strings, null and NaN. */
export function requirePositiveCents(body: JsonObject, field: string): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid(`${field} must be a positive whole number of cents`)
  }
  return value
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 255

export function requireIdempotencyKey(c: Context): string {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key header is required')
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiError(
      400,
      `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    )
  }
  return key
}
