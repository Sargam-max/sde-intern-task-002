import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError, api, type Bill, getSimulate, type SimulateMode, setSimulate } from './api'

type LogLine = { id: number; label: string; result: string; ok: boolean }

const statusOf = (err: unknown) =>
  err instanceof ApiError ? `${err.status || 'no answer'}: ${err.message}` : String(err)

/**
 * Dev-only panel that triggers each "case you must handle" against the real API and
 * prints what came back. Collapsible so it stays clean in the UI.
 */
export function EdgeCasePanel({
  homeId,
  bills,
  onChanged,
  onReload,
}: {
  homeId: string
  bills: Bill[]
  onChanged: () => void
  onReload: () => void
}) {
  const [mode, setMode] = useState<SimulateMode>(getSimulate)
  const [log, setLog] = useState<LogLine[]>([])
  const [busy, setBusy] = useState(false)

  const add = (label: string, result: string, ok: boolean) =>
    setLog((lines) =>
      [{ id: Date.now() + Math.random(), label, result, ok }, ...lines].slice(0, 12),
    )

  function firstUnpaid() {
    for (const bill of bills) {
      const share = bill.shares.find((s) => s.paidAt === null)
      if (share) return { bill, share }
    }
    return null
  }

  async function run(label: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (err) {
      add(label, statusOf(err), false)
    } finally {
      setBusy(false)
    }
  }

  const needUnpaid = (label: string) => {
    const target = firstUnpaid()
    if (!target) add(label, 'Add a bill with an unpaid share first.', false)
    return target
  }

  const samePaymentTwice = () =>
    run('Same payment sent twice', async () => {
      const label = 'Same payment sent twice'
      const target = needUnpaid(label)
      if (!target) return
      const key = crypto.randomUUID()
      const first = await api.payShare(target.bill.id, target.share.id, key)
      const second = await api.payShare(target.bill.id, target.share.id, key)
      add(
        label,
        `both answered 200 · same paidAt: ${first.paidAt === second.paidAt ? 'yes' : 'NO'} · paid once`,
        first.paidAt === second.paidAt,
      )
      onChanged()
    })

  const twoPayersAtOnce = () =>
    run('Two members pay the same share at once', async () => {
      const label = 'Two members pay the same share at once'
      const target = needUnpaid(label)
      if (!target) return
      const results = await Promise.allSettled([
        api.payShare(target.bill.id, target.share.id, crypto.randomUUID()),
        api.payShare(target.bill.id, target.share.id, crypto.randomUUID()),
      ])
      const codes = results.map((r) =>
        r.status === 'fulfilled' ? '200' : r.reason instanceof ApiError ? r.reason.status : '?',
      )
      const winners = results.filter((r) => r.status === 'fulfilled').length
      add(label, `answers: ${codes.join(' and ')} · ${winners} payment succeeded`, winners === 1)
      onChanged()
    })

  const expectError = (label: string, status: number, action: () => Promise<unknown>) =>
    run(label, async () => {
      try {
        await action()
        add(label, 'unexpectedly succeeded', false)
      } catch (err) {
        add(label, statusOf(err), err instanceof ApiError && err.status === status)
      }
    })

  const invalidAmounts = () =>
    run('Invalid amounts', async () => {
      const values: unknown[] = [0, -100, 10.5, '1000', null]
      const parts: string[] = []
      let allRejected = true
      for (const value of values) {
        try {
          await api.createBillUnchecked(homeId, 'Invalid amount test', value)
          parts.push(`${JSON.stringify(value)} → 201`)
          allRejected = false
        } catch (err) {
          const status = err instanceof ApiError ? err.status : 0
          if (status !== 422) allRejected = false
          parts.push(`${JSON.stringify(value)} → ${status}`)
        }
      }
      add('Invalid amounts sent straight to the API', parts.join(' · '), allRejected)
    })

  const emptyHome = () =>
    expectError('Bill for a home with no members', 422, async () => {
      const home = await api.createHome('Empty home (test)')
      return api.createBill(home.id, 'Rent', 1000)
    })

  const changeMode = (next: SimulateMode) => {
    setMode(next)
    setSimulate(next)
  }

  const someBill = bills[0]

  return (
    <details className="card dev-panel-details">
      <summary className="dev-panel-summary">
        <div className="dev-panel-summary-left">
          <span className="dev-badge">DEV TOOL</span>
          <strong>Test the edge cases (7 required scenarios)</strong>
        </div>
        <span className="dev-toggle-hint">Click to expand / collapse</span>
      </summary>

      <div className="dev-panel-body">
        <p className="muted small" style={{ margin: '8px 0 14px' }}>
          Shown only in development. Each button calls the real API and prints the live result.
        </p>

        <div className="test-grid">
          <button type="button" disabled={busy} onClick={emptyHome}>
            1 · Home with no members
          </button>
          <button type="button" disabled={busy} onClick={invalidAmounts}>
            2 · Zero, negative, decimal amounts
          </button>
          <button type="button" disabled={busy} onClick={samePaymentTwice}>
            4 · Same payment sent twice
          </button>
          <button type="button" disabled={busy} onClick={twoPayersAtOnce}>
            5 · Two payers at the same time
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              expectError('Pay a share that does not exist', 404, () =>
                api.payShare(someBill?.id ?? 'no-bill', 'does-not-exist', crypto.randomUUID()),
              )
            }
          >
            6 · Share that does not exist
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              expectError('Pay on a bill that does not exist', 404, () =>
                api.payShare('does-not-exist', 'does-not-exist', crypto.randomUUID()),
              )
            }
          >
            6 · Bill that does not exist
          </button>
        </div>

        <p className="muted small" style={{ margin: '8px 0 14px' }}>
          3 · Uneven amounts: type 10.00 in “New bill” with 3 members to see the split preview.{' '}
          <Link to="/homes/$homeId" params={{ homeId: 'does-not-exist' }}>
            Open a home that does not exist
          </Link>
        </p>

        <fieldset className="simulate">
          <legend>7 · Make the API fail (applies to every request from this page)</legend>
          {(
            [
              ['off', 'Normal'],
              ['slow', 'Slow (3 s)'],
              ['timeout', 'Too slow (times out)'],
              ['error', '500 error'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="radio">
              <input
                type="radio"
                name="simulate"
                checked={mode === value}
                onChange={() => changeMode(value)}
              />
              {label}
            </label>
          ))}
          <button type="button" className="secondary" onClick={onReload}>
            Reload page data
          </button>
        </fieldset>

        {log.length > 0 && (
          <ul className="test-log" aria-live="polite">
            {log.map((line) => (
              <li key={line.id} className={line.ok ? 'ok' : 'bad'}>
                <strong>
                  {line.ok ? '✓' : '✗'} {line.label}
                </strong>
                <span>{line.result}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
