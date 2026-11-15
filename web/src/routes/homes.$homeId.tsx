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

function getCategoryIcon(title: string): string {
  const lower = title.toLowerCase()
  if (/electric|power|energy|kwh/.test(lower)) return '⚡'
  if (/internet|wifi|broadband|fiber/.test(lower)) return '🌐'
  if (/water|sewer|utility/.test(lower)) return '💧'
  if (/gas|heating|lpg/.test(lower)) return '🔥'
  if (/rent|lease|mortgage/.test(lower)) return '🏠'
  if (/grocer|supermarket|food|dining/.test(lower)) return '🛒'
  if (/clean|trash|waste/.test(lower)) return '🧹'
  return '📄'
}

function getAvatarColor(name: string): string {
  const colors = [
    '#4f46e5', // indigo
    '#059669', // emerald
    '#d97706', // amber
    '#dc2626', // rose
    '#7c3aed', // violet
    '#0284c7', // sky
    '#0d9488', // teal
    '#e11d48', // pink
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length] ?? '#4f46e5'
}

function HomePage() {
  const { homeId } = Route.useParams()
  const { state, retry, refresh, applyPaidShare, addMemberLocally } = useHomeData(homeId)

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
          <div className="card loading-card" role="status" aria-live="polite">
            <span className="spinner large" aria-hidden="true" />
            <p>Loading household expenses & members…</p>
          </div>
        ) : (
          <div className="alert" role="alert">
            <strong>Could not load this home.</strong> {state.message}
            <div style={{ marginTop: '12px' }}>
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

  // Financial summary metrics
  const totalBilledCents = bills.reduce((acc, b) => acc + b.totalCents, 0)
  const totalOutstandingCents = balances.reduce((acc, b) => acc + b.outstandingCents, 0)
  const totalSettledCents = Math.max(0, totalBilledCents - totalOutstandingCents)

  return (
    <Page title={home.name} memberCount={home.members.length} billCount={bills.length}>
      {state.refreshError && (
        <div className="alert alert-soft" role="alert">
          Could not refresh: {state.refreshError}{' '}
          <button type="button" className="link" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <section className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header-row">
            <span className="metric-label">Total Expenses</span>
            <span className="metric-beacon-dot ok" title="Live sync" />
          </div>
          <span className="metric-value">{formatCents(totalBilledCents)}</span>
          <span className="metric-sub">{bills.length} bills recorded</span>
        </div>
        <div className="metric-card highlight-warn">
          <div className="metric-header-row">
            <span className="metric-label">Total Outstanding</span>
            {totalOutstandingCents > 0 && (
              <span className="metric-beacon-dot warn" title="Pending" />
            )}
          </div>
          <span className="metric-value warn">{formatCents(totalOutstandingCents)}</span>
          <span className="metric-sub">Across all roommates</span>
        </div>
        <div className="metric-card highlight-ok">
          <div className="metric-header-row">
            <span className="metric-label">Settled / Paid</span>
            <span className="metric-beacon-dot ok" title="Verified" />
          </div>
          <span className="metric-value ok">{formatCents(totalSettledCents)}</span>
          <span className="metric-sub">
            {totalBilledCents > 0
              ? `${Math.round((totalSettledCents / totalBilledCents) * 100)}% resolved`
              : 'All settled up'}
          </span>
        </div>
      </section>

      {/* Dashboard 2-Column Layout */}
      <div className="dashboard-grid">
        {/* Main Column: Bills Feed */}
        <div className="dashboard-main">
          <div className="section-header">
            <h2>Shared Bills</h2>
            <span className="pill-badge">{bills.length}</span>
          </div>

          {bills.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">🧾</span>
              <h3>No bills recorded yet</h3>
              <p className="muted">
                Add a bill on the right to split it automatically between all roommates.
              </p>
            </div>
          ) : (
            <div className="bills-stack">
              {bills.map((bill) => (
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
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Column: New Bill Form + Roommate Balances */}
        <div className="dashboard-sidebar">
          {/* New Bill Card */}
          <section className="card card-sidebar">
            <div className="card-header">
              <h2>Add New Bill</h2>
              <span className="card-badge">Instant Split</span>
            </div>
            {home.members.length === 0 && (
              <p className="notice">
                Add at least one roommate below first before creating a bill.
              </p>
            )}
            <AddBillForm homeId={home.id} members={home.members} onAdded={refresh} />
          </section>

          {/* Members & Balances Card */}
          <section className="card card-sidebar">
            <div className="card-header">
              <h2>Roommates & Balances</h2>
              <span className="pill-badge">{home.members.length}</span>
            </div>
            <MemberList members={home.members} balances={balances} />
            <AddMemberForm
              homeId={home.id}
              onAdded={(member) => {
                addMemberLocally(member)
                void refresh()
              }}
            />
          </section>
        </div>
      </div>

      {panel}
    </Page>
  )
}

function ShareButton() {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      type="button"
      className="btn-share-pill"
      onClick={handleCopy}
      title="Copy household link"
      aria-label="Copy household link"
    >
      {copied ? '✓ Copied!' : '🔗 Share'}
    </button>
  )
}

function Page({
  title,
  memberCount,
  billCount,
  children,
}: {
  title?: string
  memberCount?: number
  billCount?: number
  children: React.ReactNode
}) {
  return (
    <main className="page">
      <header className="app-header">
        <nav className="breadcrumbs">
          <Link to="/" className="breadcrumb-link">
            ← All homes
          </Link>
        </nav>
        {title && (
          <div className="home-title-row">
            <div className="home-title-group">
              <span className="home-icon">🏠</span>
              <h1>{title}</h1>
            </div>
            {memberCount !== undefined && billCount !== undefined && (
              <div className="header-meta">
                <span className="meta-pill">
                  👥 {memberCount} {memberCount === 1 ? 'roommate' : 'roommates'}
                </span>
                <span className="meta-pill">
                  🧾 {billCount} {billCount === 1 ? 'bill' : 'bills'}
                </span>
                <ShareButton />
              </div>
            )}
          </div>
        )}
      </header>
      {children}
    </main>
  )
}

function MemberList({ members, balances }: { members: Member[]; balances: Balance[] }) {
  if (members.length === 0) {
    return (
      <div className="empty-compact">
        <p className="muted">No roommates yet. Add someone below.</p>
      </div>
    )
  }

  const owed = new Map(balances.map((b) => [b.memberId, b.outstandingCents]))

  return (
    <ul className="members-list">
      {members.map((m, index) => {
        const debt = owed.get(m.id) ?? 0
        const initial = m.name.trim().charAt(0).toUpperCase() || '?'
        const avatarBg = getAvatarColor(m.name)
        return (
          <li key={m.id} className="member-item">
            <div className="member-info">
              <div className="avatar" style={{ backgroundColor: avatarBg }}>
                {initial}
              </div>
              <div>
                <span className="member-name">{m.name}</span>
                <span className="member-order">Order #{index + 1}</span>
              </div>
            </div>
            <div className="member-debt">
              {debt > 0 ? (
                <span className="debt-badge debt-warn">owes {formatCents(debt)}</span>
              ) : (
                <span className="debt-badge debt-ok">✓ Settled</span>
              )}
            </div>
          </li>
        )
      })}
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
  const totalCount = bill.shares.length
  const percentPaid = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0
  const extraCents = totalCount > 0 ? bill.totalCents % totalCount : 0
  const icon = getCategoryIcon(bill.title)

  return (
    <article className="card bill-card">
      <header className="bill-card-header">
        <div className="bill-meta-left">
          <span className="bill-cat-icon">{icon}</span>
          <div>
            <h3>{bill.title}</h3>
            <span className="bill-sub">
              {paidCount} of {totalCount} paid ({percentPaid}%)
            </span>
          </div>
        </div>
        <div className="bill-amount-badge">
          <span className="amount-label">Total</span>
          <span className="amount-value">{formatCents(bill.totalCents)}</span>
        </div>
      </header>

      {/* Visual Progress Bar */}
      <div className="bill-progress-wrap">
        <div className="bill-progress-bar">
          <div className="bill-progress-fill" style={{ width: `${percentPaid}%` }} />
        </div>
      </div>

      {extraCents > 0 && (
        <p className="split-footnote">
          ℹ️ {formatCents(bill.totalCents)} does not divide evenly by {totalCount}: first{' '}
          {extraCents === 1 ? 'roommate pays' : `${extraCents} roommates pay`} 1¢ more.
        </p>
      )}

      {/* Attachment Row */}
      <AttachmentRow bill={bill} onUploaded={onUploaded} />

      {/* Shares Table */}
      <div className="table-responsive">
        <table className="shares-table">
          <thead>
            <tr>
              <th scope="col">Roommate</th>
              <th scope="col" className="num">
                Share
              </th>
              <th scope="col" style={{ width: '130px' }}>
                Status
              </th>
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
      </div>
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
          message: err.status === 409 ? 'Already paid.' : message,
        })
        onConflict()
        return
      }
      setPay({ status: 'error', message })
    }
  }

  const isPaid = share.paidAt !== null
  const initial = memberName.trim().charAt(0).toUpperCase() || '?'
  const avatarBg = getAvatarColor(memberName)

  return (
    <tr className={isPaid ? 'row-paid' : ''}>
      <td>
        <div className="member-cell">
          <div className="avatar avatar-sm" style={{ backgroundColor: avatarBg }}>
            {initial}
          </div>
          <span className="member-cell-name">{memberName}</span>
        </div>
      </td>
      <td className="num">{formatCents(share.amountCents)}</td>
      <td>
        {isPaid ? (
          <span className="badge badge-paid">
            <span className="badge-icon">✓</span> Paid
          </span>
        ) : (
          <div className="pay-cell">
            <button
              type="button"
              className="btn-pay"
              disabled={pay.status === 'paying'}
              onClick={handlePay}
            >
              {pay.status === 'paying' ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Paying…
                </>
              ) : pay.status === 'error' ? (
                'Retry'
              ) : (
                'Pay Share'
              )}
            </button>
            {pay.status === 'error' && (
              <span className="pay-error" title={pay.message}>
                ⚠️ {pay.message}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  )
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
    <form className="add-member-form" onSubmit={submit}>
      <div className="input-with-button">
        <label>
          <span className="sr-only">Roommate name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add roommate name, e.g. Alex"
            maxLength={100}
            disabled={busy}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Adding…' : '+ Add'}
        </button>
      </div>
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
    <div className="attachment-strip">
      <div className="attachment-left">
        {attachment ? (
          <a
            href={api.attachmentUrl(bill.id)}
            target="_blank"
            rel="noreferrer"
            className="attachment-link"
          >
            📎 <strong>{attachment.filename}</strong> ({formatBytes(attachment.sizeBytes)})
          </a>
        ) : (
          <span className="attachment-empty">No receipt attached</span>
        )}
      </div>
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
        className="btn-attach"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : attachment ? 'Replace file' : '+ Attach file'}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
