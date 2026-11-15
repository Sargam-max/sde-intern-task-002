import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useRef, useState } from 'react'
import { AddBillForm } from '../AddBillForm'
import {
  ApiError,
  api,
  type Balance,
  type Bill,
  formatBytes,
  formatCents,
  type Member,
  type Share,
  UPLOAD_ACCEPT,
} from '../api'
import { prepareUpload } from '../billReader/prepareUpload'
import { EdgeCasePanel } from '../EdgeCasePanel'
import { useHomeData } from '../useHomeData'

export const Route = createFileRoute('/homes/$homeId')({
  component: HomePage,
})

function HomePage() {
  const { homeId } = Route.useParams()
  const { state, retry, refresh, applyPaidShare, addMemberLocally } = useHomeData(homeId)

  // Rendered in every state and always in the same place, so it keeps its settings
  // while the page itself switches between loading, error and ready.
  const panel = import.meta.env.DEV ? (
    <EdgeCasePanel
      homeId={homeId}
      bills={state.status === 'ready' ? state.data.bills : []}
      onChanged={refresh}
      onReload={retry}
    />
  ) : null

  if (state.status !== 'ready') {
    return (
      <Page>
        {state.status === 'loading' ? (
          <p className="muted" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> Loading bills…
          </p>
        ) : (
          <div className="alert" role="alert">
            <strong>Could not load this home.</strong> {state.message}
            <div>
              <button type="button" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        )}
        {panel}
      </Page>
    )
  }

  const { home, bills, balances } = state.data
  const membersById = new Map(home.members.map((m) => [m.id, m]))

  return (
    <Page title={home.name}>
      {state.refreshError && (
        <div className="alert alert-soft" role="alert">
          Could not refresh: {state.refreshError}{' '}
          <button type="button" className="link" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      <section className="card">
        <h2>Members</h2>
        <MemberList members={home.members} balances={balances} />
        <AddMemberForm
          homeId={home.id}
          onAdded={(member) => {
            addMemberLocally(member)
            void refresh()
          }}
        />
      </section>

      <section className="card">
        <h2>New bill</h2>
        {home.members.length === 0 && (
          <p className="notice">
            This home has no members yet, so there is nobody to split a bill between. Add a member
            first. If you try anyway, the server refuses the bill.
          </p>
        )}
        <AddBillForm homeId={home.id} members={home.members} onAdded={refresh} />
      </section>

      <section>
        <h2>Bills</h2>
        {bills.length === 0 ? (
          <div className="empty">
            <p>No bills yet.</p>
            <p className="muted">Bills you add are split between all members.</p>
          </div>
        ) : (
          bills.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              membersById={membersById}
              onPaid={(share) => {
                applyPaidShare(bill.id, share)
                void refresh()
              }}
              onConflict={refresh}
              onUploaded={refresh}
            />
          ))
        )}
      </section>
      {panel}
    </Page>
  )
}

function Page({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="page">
      <nav>
        <Link to="/">← All homes</Link>
      </nav>
      {title ? <h1>{title}</h1> : null}
      {children}
    </main>
  )
}

function MemberList({ members, balances }: { members: Member[]; balances: Balance[] }) {
  if (members.length === 0) {
    return <p className="muted">No members yet.</p>
  }
  const owed = new Map(balances.map((b) => [b.memberId, b.outstandingCents]))
  return (
    <ul className="members">
      {members.map((m) => (
        <li key={m.id}>
          <span>{m.name}</span>
          <span className="muted">owes {formatCents(owed.get(m.id) ?? 0)}</span>
        </li>
      ))}
    </ul>
  )
}

function BillCard({
  bill,
  membersById,
  onPaid,
  onConflict,
  onUploaded,
}: {
  bill: Bill
  membersById: Map<string, Member>
  onPaid: (share: Share) => void
  onConflict: () => void
  onUploaded: () => void
}) {
  const paidCount = bill.shares.filter((s) => s.paidAt !== null).length
  const extraCents = bill.shares.length > 0 ? bill.totalCents % bill.shares.length : 0
  return (
    <article className="card">
      <header className="bill-header">
        <h3>{bill.title}</h3>
        <span className="amount">{formatCents(bill.totalCents)}</span>
      </header>
      <p className="muted">
        {paidCount} of {bill.shares.length} paid
        {extraCents > 0 &&
          ` · ${formatCents(bill.totalCents)} does not divide evenly by ${bill.shares.length}, so the first ${extraCents === 1 ? 'member pays' : `${extraCents} members pay`} 1¢ more`}
      </p>
      <AttachmentRow bill={bill} onUploaded={onUploaded} />
      <table>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col" className="num">
              Share
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {bill.shares.map((share) => (
            <ShareRow
              key={share.id}
              billId={bill.id}
              share={share}
              memberName={membersById.get(share.memberId)?.name ?? 'Unknown member'}
              onPaid={onPaid}
              onConflict={onConflict}
            />
          ))}
        </tbody>
      </table>
    </article>
  )
}

type PayState = { status: 'idle' } | { status: 'paying' } | { status: 'error'; message: string }

function ShareRow({
  billId,
  share,
  memberName,
  onPaid,
  onConflict,
}: {
  billId: string
  share: Share
  memberName: string
  onPaid: (share: Share) => void
  onConflict: () => void
}) {
  const [pay, setPay] = useState<PayState>({ status: 'idle' })
  // One key per payment attempt of this share. It is kept after a failure, so pressing
  // "Retry" sends the same key: if the first request did reach the server, the retry gets
  // the same answer back instead of a 409 or a double payment.
  const keyRef = useRef<string | null>(null)

  async function handlePay() {
    if (pay.status === 'paying') return
    keyRef.current ??= crypto.randomUUID()
    setPay({ status: 'paying' })
    try {
      const paid = await api.payShare(billId, share.id, keyRef.current)
      keyRef.current = null
      setPay({ status: 'idle' })
      onPaid(paid)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed.'
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        keyRef.current = null
        setPay({
          status: 'error',
          message: err.status === 409 ? 'Someone already paid this share.' : message,
        })
        onConflict()
        return
      }
      // The share stays unpaid on screen. Nothing changes until the server confirms.
      setPay({ status: 'error', message })
    }
  }

  const isPaid = share.paidAt !== null

  return (
    <tr>
      <td>{memberName}</td>
      <td className="num">{formatCents(share.amountCents)}</td>
      <td>
        {isPaid ? (
          <span className="badge badge-paid" title={share.paidAt ?? undefined}>
            Paid {formatTime(share.paidAt)}
          </span>
        ) : (
          <div className="pay-cell">
            <span className="badge">Unpaid</span>
            <button
              type="button"
              onClick={handlePay}
              disabled={pay.status === 'paying'}
              aria-busy={pay.status === 'paying'}
            >
              {pay.status === 'paying' ? 'Paying…' : pay.status === 'error' ? 'Retry' : 'Pay'}
            </button>
          </div>
        )}
        {pay.status === 'error' && !isPaid && (
          <p className="field-error" role="alert">
            {pay.message}
          </p>
        )}
      </td>
    </tr>
  )
}

function formatTime(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

function AddMemberForm({ homeId, onAdded }: { homeId: string; onAdded: (member: Member) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setError('Enter a name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const member = await api.addMember(homeId, name)
      setName('')
      onAdded(member)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        <span className="sr-only">Member name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Member name"
          maxLength={100}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function AttachmentRow({ bill, onUploaded }: { bill: Bill; onUploaded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(picked: File) {
    setBusy(true)
    setError(null)
    try {
      // Big phone photos are shrunk to fit the 1 MB limit first.
      const ready = await prepareUpload(picked)
      if (ready.error !== null) {
        setError(ready.error)
        return
      }
      await api.uploadAttachment(bill.id, ready.file)
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const attachment = bill.attachment ?? null

  return (
    <div className="attachment">
      {attachment ? (
        <a href={api.attachmentUrl(bill.id)} target="_blank" rel="noreferrer">
          📄 {attachment.filename} ({formatBytes(attachment.sizeBytes)})
        </a>
      ) : (
        <span className="muted">No bill file</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : attachment ? 'Replace file' : 'Upload bill'}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
