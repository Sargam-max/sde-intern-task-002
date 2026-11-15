import { Hono } from 'hono'
import { notFound } from '../lib/errors'
import { type AppEnv, type HomeRow, type MemberRow, toMember } from '../lib/types'
import { readJsonObject, requireText } from '../lib/validate'

const MAX_NAME_LENGTH = 100

export async function findHome(db: D1Database, homeId: string): Promise<HomeRow> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) throw notFound('home')
  return home
}

export async function listMembers(db: D1Database, homeId: string): Promise<MemberRow[]> {
  const { results } = await db
    .prepare('SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY position')
    .bind(homeId)
    .all<MemberRow>()
  return results
}

export const homes = new Hono<AppEnv>()

homes.post('/', async (c) => {
  const body = await readJsonObject(c)
  const name = requireText(body, 'name', MAX_NAME_LENGTH)

  const home = await c.env.DB.prepare(
    'INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?) RETURNING id, name',
  )
    .bind(crypto.randomUUID(), name, new Date().toISOString())
    .first<HomeRow>()

  return c.json(home, 201)
})

// Lists every home so the start page can show them. There are no user accounts in this
// assignment, so every home is visible; with accounts this would filter by user.
homes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.name,
            (SELECT COUNT(*) FROM members m WHERE m.home_id = h.id) AS member_count,
            (SELECT COUNT(*) FROM bills b WHERE b.home_id = h.id) AS bill_count
     FROM homes h
     ORDER BY h.created_at DESC, h.rowid DESC
     LIMIT 100`,
  ).all<{ id: string; name: string; member_count: number; bill_count: number }>()

  return c.json({
    homes: results.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: row.member_count,
      billCount: row.bill_count,
    })),
  })
})

homes.get('/:homeId', async (c) => {
  const db = c.env.DB
  const home = await findHome(db, c.req.param('homeId'))
  const members = await listMembers(db, home.id)
  return c.json({ id: home.id, name: home.name, members: members.map(toMember) })
})

homes.post('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readJsonObject(c)
  const name = requireText(body, 'name', MAX_NAME_LENGTH)

  // One statement does three things at once: checks the home exists (no row from `homes`
  // means nothing is inserted), picks the next position, and inserts. A single statement
  // is atomic, so two members added at the same time can never get the same position.
  // UNIQUE (home_id, position) is the safety net if that ever changed.
  const member = await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position, created_at)
     SELECT ?1, homes.id, ?2,
            COALESCE((SELECT MAX(position) FROM members WHERE home_id = homes.id), 0) + 1,
            ?3
     FROM homes WHERE homes.id = ?4
     RETURNING id, home_id, name`,
  )
    .bind(crypto.randomUUID(), name, new Date().toISOString(), homeId)
    .first<MemberRow>()

  if (!member) throw notFound('home')
  return c.json(toMember(member), 201)
})

homes.get('/:homeId/balances', async (c) => {
  const db = c.env.DB
  const home = await findHome(db, c.req.param('homeId'))

  const { results } = await db
    .prepare(
      `SELECT m.id AS member_id,
              m.name AS name,
              COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0)
                AS outstanding_cents
       FROM members m
       LEFT JOIN shares s ON s.member_id = m.id
       WHERE m.home_id = ?
       GROUP BY m.id, m.name, m.position
       ORDER BY m.position`,
    )
    .bind(home.id)
    .all<{ member_id: string; name: string; outstanding_cents: number }>()

  return c.json({
    balances: results.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      outstandingCents: row.outstanding_cents,
    })),
  })
})
