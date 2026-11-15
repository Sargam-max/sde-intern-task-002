import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** An expected failure that maps to an HTTP status and a `{ error }` JSON body. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode

  constructor(status: ContentfulStatusCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`)
export const invalid = (message: string) => new ApiError(422, message)
