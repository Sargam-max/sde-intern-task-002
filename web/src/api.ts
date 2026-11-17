// Small typed client for the bill splitter API.
// Every response is checked at runtime, so a broken or unexpected answer becomes a
// normal error the page can show, never a crash further down.

export type Member = { id: string; homeId: string; name: string }
export type Home = { id: string; name: string; members: Member[] }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type AttachmentInfo = {
  filename: string
  contentType: string
  sizeBytes: number
  uploadedAt: string
}
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
  /** Only in the bill list. */
  attachment?: AttachmentInfo | null
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

export type BackendParsedBill = {
  title: string | null
  totalCents: number | null
  payableAmount: number | null
  currency: string
  dueDate: string | null
  explanation: string | null
  candidates: Array<{ cents: number; line: string; score: number }>
  text: string
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const TIMEOUT_MS = 10_000

// ---- dev-only failure simulation -------------------------------------------
// The edge-case panel sets this. It adds an `x-simulate` header that the Vite dev server
// (see vite.config.ts) answers with a slow reply or a 500, so the page can be shown
// handling a broken API. The header is never sent in a production build.
export type SimulateMode = 'off' | 'slow' | 'timeout' | 'error'
let simulate: SimulateMode = 'off'
export const getSimulate = (): SimulateMode => simulate
export const setSimulate = (mode: SimulateMode) => {
  simulate = mode
}

type Guard<T> = (value: unknown) => value is T

async function request<T>(
  path: string,
  guard: Guard<T>,
  init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; headers?: Record<string, string> } = {},
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  let response: Response
  try {
    const isForm = init.body instanceof FormData
    const headers: Record<string, string> = { ...init.headers }
    // For FormData the browser sets the multipart content type (with its boundary) itself.
    if (!isForm) headers['content-type'] = 'application/json'
    if (import.meta.env.DEV && simulate !== 'off') headers['x-simulate'] = simulate

    response = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body:
        init.body instanceof FormData
          ? init.body
          : init.body === undefined
            ? undefined
            : JSON.stringify(init.body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    if (timeout.aborted) throw new ApiError(0, 'The server took too long to answer.')
    throw new ApiError(0, 'Could not reach the server. Check your connection.')
  }

  const data: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      isRecord(data) && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status})`
    throw new ApiError(response.status, message)
  }
  if (!guard(data)) {
    throw new ApiError(response.status, 'The server sent an unexpected answer.')
  }
  return data
}

// ---- runtime guards -------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

function isMember(v: unknown): v is Member {
  return isRecord(v) && isString(v.id) && isString(v.homeId) && isString(v.name)
}

function isShare(v: unknown): v is Share {
  return (
    isRecord(v) &&
    isString(v.id) &&
    isString(v.memberId) &&
    isInt(v.amountCents) &&
    (v.paidAt === null || isString(v.paidAt))
  )
}

function isAttachment(v: unknown): v is AttachmentInfo {
  return (
    isRecord(v) &&
    isString(v.filename) &&
    isString(v.contentType) &&
    isInt(v.sizeBytes) &&
    isString(v.uploadedAt)
  )
}

function isBill(v: unknown): v is Bill {
  return (
    isRecord(v) &&
    (v.attachment === undefined || v.attachment === null || isAttachment(v.attachment)) &&
    isString(v.id) &&
    isString(v.title) &&
    isInt(v.totalCents) &&
    Array.isArray(v.shares) &&
    v.shares.every(isShare)
  )
}

function isHome(v: unknown): v is Home {
  return (
    isRecord(v) &&
    isString(v.id) &&
    isString(v.name) &&
    Array.isArray(v.members) &&
    v.members.every(isMember)
  )
}

const isCreatedHome = (v: unknown): v is { id: string; name: string } =>
  isRecord(v) && isString(v.id) && isString(v.name)

const isBillList = (v: unknown): v is { bills: Bill[] } =>
  isRecord(v) && Array.isArray(v.bills) && v.bills.every(isBill)

const isBalanceList = (v: unknown): v is { balances: Balance[] } =>
  isRecord(v) &&
  Array.isArray(v.balances) &&
  v.balances.every(
    (b) => isRecord(b) && isString(b.memberId) && isString(b.name) && isInt(b.outstandingCents),
  )

// ---- endpoints ------------------------------------------------------------

export type HomeSummary = { id: string; name: string; memberCount: number; billCount: number }

const isHomeList = (v: unknown): v is { homes: HomeSummary[] } =>
  isRecord(v) &&
  Array.isArray(v.homes) &&
  v.homes.every(
    (h) =>
      isRecord(h) &&
      isString(h.id) &&
      isString(h.name) &&
      isInt(h.memberCount) &&
      isInt(h.billCount),
  )

/** Must match API_VERSION in api/src/index.ts. */
export const EXPECTED_API_VERSION = 3

export const api = {
  getVersion: async (signal?: AbortSignal) =>
    (
      await request(
        '/api/version',
        (v): v is { version: number } => isRecord(v) && isInt(v.version),
        {},
        signal,
      )
    ).version,

  listHomes: async (signal?: AbortSignal) =>
    (await request('/api/homes', isHomeList, {}, signal)).homes,

  createHome: (name: string) =>
    request('/api/homes', isCreatedHome, { method: 'POST', body: { name } }),

  getHome: (homeId: string, signal?: AbortSignal) =>
    request(`/api/homes/${encodeURIComponent(homeId)}`, isHome, {}, signal),

  addMember: (homeId: string, name: string) =>
    request(`/api/homes/${encodeURIComponent(homeId)}/members`, isMember, {
      method: 'POST',
      body: { name },
    }),

  listBills: async (homeId: string, signal?: AbortSignal) =>
    (await request(`/api/homes/${encodeURIComponent(homeId)}/bills`, isBillList, {}, signal)).bills,

  getBalances: async (homeId: string, signal?: AbortSignal) =>
    (await request(`/api/homes/${encodeURIComponent(homeId)}/balances`, isBalanceList, {}, signal))
      .balances,

  createBill: (homeId: string, title: string, totalCents: number) =>
    request(`/api/homes/${encodeURIComponent(homeId)}/bills`, isBill, {
      method: 'POST',
      body: { title, totalCents },
    }),

  /** Sends any value as totalCents, without checking it first. Used by the edge-case panel. */
  createBillUnchecked: (homeId: string, title: string, totalCents: unknown) =>
    request(`/api/homes/${encodeURIComponent(homeId)}/bills`, isBill, {
      method: 'POST',
      body: { title, totalCents },
    }),

  uploadAttachment: (billId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request(`/api/bills/${encodeURIComponent(billId)}/attachment`, isAttachment, {
      method: 'PUT',
      body: form,
    })
  },

  attachmentUrl: (billId: string) => `/api/bills/${encodeURIComponent(billId)}/attachment`,

  payShare: (billId: string, shareId: string, idempotencyKey: string) =>
    request(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      isShare,
      { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
    ),

  getAiStatus: async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/bills/ai-status', { signal })
      if (!res.ok) return { available: false, hasServerKey: false }
      return (await res.json()) as { available: boolean; hasServerKey: boolean; model?: string }
    } catch {
      return { available: false, hasServerKey: false }
    }
  },

  parseBillWithAi: async (
    file: File,
    apiKeyOverride?: string | null,
    signal?: AbortSignal,
  ): Promise<BackendParsedBill> => {
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    if (apiKeyOverride?.trim()) {
      headers['x-gemini-key'] = apiKeyOverride.trim()
    }
    const timeout = AbortSignal.timeout(TIMEOUT_MS * 2)
    const res = await fetch('/api/bills/parse', {
      method: 'POST',
      headers,
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean
      error?: string
      data?: BackendParsedBill
    } | null

    if (!res.ok || !json?.ok || !json?.data) {
      throw new ApiError(res.status, json?.error || `AI parsing failed (${res.status})`)
    }
    return json.data
  },
}

// ---- files ----------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 1024 * 1024
export const UPLOAD_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'

/** Quick check in the browser. The API checks again, by the file's real bytes. */
export function checkUpload(file: File): string | null {
  if (file.size === 0) return 'The file is empty.'
  if (file.size > MAX_UPLOAD_BYTES) return 'The file is larger than 1 MB.'
  const allowed = UPLOAD_ACCEPT.split(',')
  const hasAllowedExt = /\.(pdf|png|jpe?g|webp)$/i.test(file.name)
  if (!allowed.includes(file.type) && !hasAllowedExt) return 'Use a PDF, PNG, JPEG or WebP file.'
  return null
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---- money ----------------------------------------------------------------

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

/** Display only. Amounts stay whole cents everywhere else. */
export const formatCents = (cents: number) => money.format(cents / 100)

/** "12", "12.5", "12.50", "₹12.50", "$12.50" or "1,234.50" -> cents. Parses text without floats. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/^(?:[$₹€£]|rs\.?|inr)\s*/i, '')
    .replace(/\s+/g, '')
  const uncomma = cleaned.replace(/,/g, '')
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(uncomma)
  if (!match) return null
  const dollars = Number(match[1])
  const cents = Number((match[2] ?? '').padEnd(2, '0'))
  return dollars * 100 + cents
}
