import { Hono } from 'hono'
import { ApiError, invalid, notFound } from '../lib/errors'
import { splitCents } from '../lib/split'
import { type AppEnv, type BillRow, type Share, type ShareRow, toBill, toShare } from '../lib/types'
import {
  readJsonObject,
  requireIdempotencyKey,
  requirePositiveCents,
  requireText,
} from '../lib/validate'
import type { AttachmentInfo } from './attachments'
import { findHome, listMembers } from './homes'

const MAX_TITLE_LENGTH = 200

type BillWithAttachmentRow = BillRow & {
  filename: string | null
  content_type: string | null
  size_bytes: number | null
  uploaded_at: string | null
}

function toAttachmentInfo(row: BillWithAttachmentRow): AttachmentInfo | null {
  if (row.filename === null || row.content_type === null) return null
  return {
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes ?? 0,
    uploadedAt: row.uploaded_at ?? '',
  }
}

export const bills = new Hono<AppEnv>()

bills.post('/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const home = await findHome(db, c.req.param('homeId'))
  const body = await readJsonObject(c)
  const title = requireText(body, 'title', MAX_TITLE_LENGTH)
  const totalCents = requirePositiveCents(body, 'totalCents')

  const members = await listMembers(db, home.id)
  if (members.length === 0) {
    throw invalid('home has no members to split the bill between')
  }

  const amounts = splitCents(totalCents, members.length)
  const billId = crypto.randomUUID()
  const shares: Share[] = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: amounts[index] ?? 0,
    paidAt: null,
  }))

  // batch() runs all statements in one transaction: either the bill and every share
  // are saved, or nothing is. A bill can never exist with missing shares.
  await db.batch([
    db
      .prepare(
        'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(billId, home.id, title, totalCents, new Date().toISOString()),
    ...shares.map((share, index) =>
      db
        .prepare(
          `INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(share.id, billId, home.id, share.memberId, share.amountCents, index + 1),
    ),
  ])

  return c.json({ id: billId, homeId: home.id, title, totalCents, shares }, 201)
})

bills.get('/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const home = await findHome(db, c.req.param('homeId'))

  const [billRows, shareRows] = await Promise.all([
    db
      .prepare(
        `SELECT b.id, b.home_id, b.title, b.total_cents,
                a.filename, a.content_type, a.size_bytes, a.uploaded_at
         FROM bills b
         LEFT JOIN bill_attachments a ON a.bill_id = b.id
         WHERE b.home_id = ? ORDER BY b.created_at DESC, b.rowid DESC`,
      )
      .bind(home.id)
      .all<BillWithAttachmentRow>(),
    db
      .prepare(
        `SELECT id, bill_id, member_id, amount_cents, paid_at FROM shares
         WHERE home_id = ? ORDER BY bill_id, position`,
      )
      .bind(home.id)
      .all<ShareRow>(),
  ])

  const sharesByBill = new Map<string, Share[]>()
  for (const row of shareRows.results) {
    const list = sharesByBill.get(row.bill_id) ?? []
    list.push(toShare(row))
    sharesByBill.set(row.bill_id, list)
  }

  // The list adds `attachment` (file details, never the bytes). POST /bills keeps the
  // exact shape the assignment asks for.
  const list = billRows.results.map((row) => ({
    ...toBill(row, sharesByBill.get(row.id) ?? []),
    attachment: toAttachmentInfo(row),
  }))
  return c.json({ bills: list })
})

bills.post('/bills/:billId/shares/:shareId/pay', async (c) => {
  const db = c.env.DB
  const key = requireIdempotencyKey(c)
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  // The check ("is it unpaid?") and the write happen in one UPDATE, so there is no gap
  // between them. D1 runs writes one at a time, so when two requests race, only the first
  // finds `paid_at IS NULL`; the second updates zero rows and falls through below.
  const paid = await db
    .prepare(
      `UPDATE shares SET paid_at = ?1, idempotency_key = ?2
       WHERE id = ?3 AND bill_id = ?4 AND paid_at IS NULL
       RETURNING id, bill_id, member_id, amount_cents, paid_at`,
    )
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<ShareRow>()

  if (paid) return c.json(toShare(paid), 200)

  // Nothing was updated: the share is missing, or it was already paid.
  const existing = await db
    .prepare(
      `SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key
       FROM shares WHERE id = ? AND bill_id = ?`,
    )
    .bind(shareId, billId)
    .first<ShareRow & { idempotency_key: string | null }>()

  if (!existing) {
    const bill = await db.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
    throw notFound(bill ? 'share' : 'bill')
  }

  // Same key again: a retry of a payment that already worked. Answer exactly as before.
  if (existing.idempotency_key === key) return c.json(toShare(existing), 200)

  throw new ApiError(409, 'share is already paid')
})
