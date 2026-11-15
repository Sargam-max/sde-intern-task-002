// Extra tests written for this solution. The visible tests and helpers.ts are unchanged.
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { splitCents } from '../src/lib/split'
import { type Balance, type Bill, call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

async function billWithShares(names: string[], totalCents: number) {
  const { homeId, members } = await createHome(names)
  const bill = await createBill(homeId, totalCents)
  const [first, second] = bill.body.shares
  if (!first || !second) throw new Error('expected at least two shares')
  return { homeId, members, bill: bill.body, first, second }
}

describe('splitCents', () => {
  it.each([
    [1000, 3, [334, 333, 333]],
    [1, 3, [1, 0, 0]],
    [5, 5, [1, 1, 1, 1, 1]],
    [7, 2, [4, 3]],
  ])('splits %i between %i', (total, count, expected) => {
    expect(splitCents(total, count)).toEqual(expected)
  })

  it('always adds up and never differs by more than one cent', () => {
    for (let total = 1; total <= 500; total += 7) {
      for (let count = 1; count <= 12; count++) {
        const parts = splitCents(total, count)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('throws on bad input instead of returning a wrong split', () => {
    expect(() => splitCents(0, 3)).toThrow()
    expect(() => splitCents(10.5, 3)).toThrow()
    expect(() => splitCents(100, 0)).toThrow()
  })
})

describe('bill creation edge cases', () => {
  it('gives a member a zero share when there are fewer cents than members', async () => {
    const { homeId } = await createHome(['A', 'B', 'C'])
    const bill = await createBill(homeId, 2)
    expect(bill.status).toBe(201)
    expect(bill.body.shares.map((s) => s.amountCents)).toEqual([1, 1, 0])
  })

  it.each([
    ['missing title', { totalCents: 100 }],
    ['blank title', { title: '   ', totalCents: 100 }],
    ['NaN-like total', { title: 'Rent', totalCents: 'NaN' }],
    ['missing total', { title: 'Rent' }],
    ['float total', { title: 'Rent', totalCents: 0.1 }],
    ['huge total', { title: 'Rent', totalCents: 2 ** 60 }],
  ])('rejects %s with 422', async (_label, body) => {
    const { homeId } = await createHome(['A'])
    const res = await call<{ error: string }>('POST', `/api/homes/${homeId}/bills`, { body })
    expect(res.status).toBe(422)
    expect(res.body.error).toEqual(expect.any(String))
  })

  it('answers 400 with a JSON error for a body that is not JSON', async () => {
    const res = await call<{ error: string }>('POST', '/api/homes', { body: undefined })
    expect(res.status).toBe(400)
    expect(res.body.error).toEqual(expect.any(String))
  })

  it('rejects a home or member with an empty name', async () => {
    expect((await call('POST', '/api/homes', { body: { name: '' } })).status).toBe(422)
    const { homeId } = await createHome([])
    const member = await call('POST', `/api/homes/${homeId}/members`, { body: { name: 42 } })
    expect(member.status).toBe(422)
  })

  it('keeps member order when members are added at the same time', async () => {
    const { homeId } = await createHome([])
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    const added = await Promise.all(
      names.map((name) => call('POST', `/api/homes/${homeId}/members`, { body: { name } })),
    )
    expect(added.every((res) => res.status === 201)).toBe(true)

    const bill = await createBill(homeId, 6)
    expect(bill.body.shares).toHaveLength(6)
    expect(new Set(bill.body.shares.map((s) => s.memberId)).size).toBe(6)
  })

  it('lists the bills of a home with their shares', async () => {
    const { homeId } = await createHome(['A', 'B'])
    await createBill(homeId, 100)
    await createBill(homeId, 301)
    const list = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)
    expect(list.status).toBe(200)
    expect(list.body.bills.map((b) => b.totalCents)).toEqual([301, 100])
    expect(list.body.bills[0]?.shares.map((s) => s.amountCents)).toEqual([151, 150])
  })
})

describe('payment edge cases', () => {
  it('lets only one of two different keys pay the same share at the same time', async () => {
    const { homeId, bill, first } = await billWithShares(['A', 'B'], 1000)

    const results = await Promise.all([
      pay(bill.id, first.id, crypto.randomUUID()),
      pay(bill.id, first.id, crypto.randomUUID()),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])
  })

  it('answers the same key sent many times at once with one identical result', async () => {
    const { bill, first } = await billWithShares(['A', 'B'], 1000)
    const key = crypto.randomUUID()

    const results = await Promise.all(Array.from({ length: 5 }, () => pay(bill.id, first.id, key)))

    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(new Set(results.map((r) => r.body.paidAt)).size).toBe(1)
  })

  it('does not let a key used for one share pay or block another share', async () => {
    const { bill, first, second } = await billWithShares(['A', 'B'], 1000)
    const key = crypto.randomUUID()

    expect((await pay(bill.id, first.id, key)).status).toBe(200)
    expect((await pay(bill.id, second.id, key)).status).toBe(200)
  })

  it('returns 404 when the share exists but belongs to another bill', async () => {
    const one = await billWithShares(['A', 'B'], 1000)
    const other = await createBill(one.homeId, 400)

    const res = await pay(other.body.id, one.first.id, crypto.randomUUID())

    expect(res.status).toBe(404)
  })

  it('treats a blank Idempotency-Key as missing', async () => {
    const { bill, first } = await billWithShares(['A', 'B'], 1000)
    const res = await pay(bill.id, first.id, '   ')
    expect(res.status).toBe(400)
  })
})

describe('JSON errors', () => {
  it('answers an unknown route with a JSON 404', async () => {
    const res = await call<{ error: string }>('GET', '/api/nope')
    expect(res.status).toBe(404)
    expect(res.body.error).toEqual(expect.any(String))
  })
})

describe('database constraints', () => {
  it('rejects a bill with a decimal or zero total, even when written directly', async () => {
    const { homeId } = await createHome(['A'])
    const insert = (total: number) =>
      env.DB.prepare(
        "INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, 'x', ?, 'now')",
      )
        .bind(crypto.randomUUID(), homeId, total)
        .run()

    await expect(insert(10.5)).rejects.toThrow(/CHECK/)
    await expect(insert(0)).rejects.toThrow(/CHECK/)
  })

  it('rejects a share for a member of a different home', async () => {
    const home = await billWithShares(['A', 'B'], 1000)
    const stranger = await createHome(['Z'])
    const strangerId = stranger.members[0]?.id

    const insert = env.DB.prepare(
      `INSERT INTO shares (id, bill_id, home_id, member_id, amount_cents, position)
       VALUES (?, ?, ?, ?, 1, 99)`,
    )
      .bind(crypto.randomUUID(), home.bill.id, home.homeId, strangerId)
      .run()

    await expect(insert).rejects.toThrow(/FOREIGN KEY/)
  })

  it('rejects a share that is paid without a key', async () => {
    const { first } = await billWithShares(['A', 'B'], 1000)
    const update = env.DB.prepare("UPDATE shares SET paid_at = 'now' WHERE id = ?")
      .bind(first.id)
      .run()
    await expect(update).rejects.toThrow(/CHECK/)
  })
})

describe('listing homes', () => {
  it('lists homes newest first with member and bill counts', async () => {
    const older = await createHome(['A', 'B'])
    await createBill(older.homeId, 100)
    const newer = await createHome([])

    const res = await call<{
      homes: { id: string; name: string; memberCount: number; billCount: number }[]
    }>('GET', '/api/homes')

    expect(res.status).toBe(200)
    const ids = res.body.homes.map((h) => h.id)
    expect(ids.indexOf(newer.homeId)).toBeLessThan(ids.indexOf(older.homeId))
    expect(res.body.homes.find((h) => h.id === older.homeId)).toMatchObject({
      memberCount: 2,
      billCount: 1,
    })
  })

  it('reports the API version so the page can spot an outdated server', async () => {
    const res = await call<{ version: number }>('GET', '/api/version')
    expect(res.status).toBe(200)
    expect(res.body.version).toEqual(expect.any(Number))
  })
})

describe('worker entry module', () => {
  it('exports only the default handler (workerd refuses to start otherwise)', async () => {
    const entry = await import('../src/index')
    expect(Object.keys(entry)).toEqual(['default'])
  })
})
