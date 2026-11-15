import { type DragEvent, type FormEvent, useRef, useState } from 'react'
import {
  api,
  formatBytes,
  formatCents,
  type Member,
  parseDollarsToCents,
  UPLOAD_ACCEPT,
} from './api'
import type { AmountCandidate } from './billReader/parseBill'
import { prepareUpload } from './billReader/prepareUpload'
import type { ReadProgress, ReadResult } from './billReader/readBill'
import { previewSplit } from './split'

type Mode = 'type' | 'upload'

type ReadState =
  | { status: 'idle' }
  | { status: 'reading'; progress: ReadProgress }
  | { status: 'done'; result: ReadResult }
  | { status: 'failed'; message: string }

const centsToInput = (cents: number) => (cents / 100).toFixed(2)

/**
 * The "New bill" form. Two ways to fill in the amount:
 *  - Type the amount: title and amount by hand.
 *  - Upload the bill: pick a PDF or photo, the page reads it and fills in the total and a
 *    title. The user checks or changes them, then saves. The file is stored with the bill.
 * Either way the API gets the same { title, totalCents } and validates it again.
 */
export function AddBillForm({
  homeId,
  members,
  onAdded,
}: {
  homeId: string
  members: Member[]
  onAdded: () => void
}) {
  const [mode, setMode] = useState<Mode>('type')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [read, setRead] = useState<ReadState>({ status: 'idle' })
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const readId = useRef(0)

  const cents = parseDollarsToCents(amount)
  const amountProblem =
    amount.trim() === ''
      ? null
      : cents === null
        ? 'Amount must be a number with at most 2 decimals, like 12.50. No negatives.'
        : cents <= 0
          ? 'Amount must be more than zero.'
          : null
  const preview = cents && cents > 0 ? previewSplit(cents, members.length) : []

  function clearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setFile(null)
    setRead({ status: 'idle' })
    if (fileInput.current) fileInput.current.value = ''
  }

  function reset() {
    setTitle('')
    setAmount('')
    clearFile()
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setWarning(null)
    if (next === 'type') {
      clearFile()
    }
  }

  async function pickFile(picked: File) {
    setError(null)
    setWarning(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const isImg = picked.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(picked.name)
    setPreviewUrl(isImg ? URL.createObjectURL(picked) : null)
    setFile(picked)
    const id = ++readId.current // a newer file makes older results stale
    setRead({ status: 'reading', progress: { stage: 'loading', percent: 0 } })
    try {
      const { readBill } = await import('./billReader/readBill')
      const result = await readBill(picked, (progress) => {
        if (id === readId.current) setRead({ status: 'reading', progress })
      })
      if (id !== readId.current) return
      setRead({ status: 'done', result })
      if (result.totalCents !== null) setAmount(centsToInput(result.totalCents))
      if (result.title) setTitle((current) => current.trim() || (result.title ?? ''))
    } catch (err) {
      if (id !== readId.current) return
      setRead({
        status: 'failed',
        message: err instanceof Error ? err.message : 'The file could not be read.',
      })
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped) void pickFile(dropped)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setWarning(null)
    if (read.status === 'reading') {
      setError('Wait until the bill has been read.')
      return
    }
    if (!title.trim()) {
      setError('Enter a title.')
      return
    }
    if (cents === null || cents <= 0) {
      setError(amountProblem ?? 'Enter an amount above zero, like 12.50.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      // The server checks everything again; its message (e.g. "home has no members")
      // is shown as is.
      const bill = await api.createBill(homeId, title, cents)
      if (file) {
        const ready = await prepareUpload(file)
        if (ready.error !== null) {
          setWarning(`The bill was added without the file: ${ready.error}`)
        } else {
          try {
            await api.uploadAttachment(bill.id, ready.file)
          } catch (err) {
            setWarning(
              `The bill was added, but the file did not upload: ${
                err instanceof Error ? err.message : 'unknown error'
              }. You can upload it again on the bill.`,
            )
          }
        }
      }
      reset()
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add bill.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="bill-form" onSubmit={submit}>
      <div className="segmented" role="tablist" aria-label="How to add the bill">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'type'}
          className={mode === 'type' ? 'active' : ''}
          onClick={() => switchMode('type')}
        >
          ✎ Type amount manually
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'upload'}
          className={mode === 'upload' ? 'active' : ''}
          onClick={() => switchMode('upload')}
        >
          ⬆ Upload & auto-read bill (PDF/Photo)
        </button>
      </div>

      {mode === 'upload' && (
        <>
          <button
            type="button"
            className={`dropzone${dragging ? ' dragging' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {file ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Uploaded bill thumbnail"
                    style={{
                      width: '48px',
                      height: '48px',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                    }}
                  />
                )}
                <span>
                  📄 <strong>{file.name}</strong> ({formatBytes(file.size)}) ·{' '}
                  <span style={{ textDecoration: 'underline' }}>choose another</span>
                </span>
                <button
                  type="button"
                  className="link"
                  style={{ marginLeft: '8px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    clearFile()
                  }}
                >
                  ✕ Remove
                </button>
              </div>
            ) : (
              <span>
                <strong>Choose a PDF or photo of the bill</strong>, or drop it here. The total is
                read automatically.
              </span>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0]
              if (picked) void pickFile(picked)
            }}
          />
          <ReadStatus read={read} onPick={(c) => setAmount(centsToInput(c.cents))} />
        </>
      )}

      <div className="inline-form">
        <div className="input-group">
          <label htmlFor="bill-title" className="input-label">
            Bill title
          </label>
          <input
            id="bill-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title, e.g. Electricity"
            maxLength={200}
          />
        </div>
        <div className="input-group">
          <label htmlFor="bill-amount" className="input-label">
            {mode === 'upload' ? 'Amount (auto-read or type)' : 'Amount in dollars ($)'}
          </label>
          <input
            id="bill-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount, e.g. 10.00"
            inputMode="decimal"
            aria-invalid={amountProblem !== null}
          />
        </div>
      </div>

      {amountProblem && <p className="field-error">{amountProblem}</p>}
      {preview.length > 0 && (
        <p className="preview">
          {formatCents(cents ?? 0)} = {cents} cents, split:{' '}
          {preview.map((part, i) => `${members[i]?.name ?? '?'} ${formatCents(part)}`).join(' · ')}
          {(cents ?? 0) % members.length !== 0 &&
            ' (does not divide evenly: the extra cents go to the first members, in join order)'}
        </p>
      )}

      <div>
        <button type="submit" disabled={busy || read.status === 'reading'}>
          {busy ? 'Adding…' : 'Add bill'}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {warning && (
        <p className="notice" role="alert">
          {warning}
        </p>
      )}
    </form>
  )
}

function ReadStatus({
  read,
  onPick,
}: {
  read: ReadState
  onPick: (candidate: AmountCandidate) => void
}) {
  if (read.status === 'idle') return null

  if (read.status === 'reading') {
    const { stage, percent } = read.progress
    return (
      <div className="read-status" role="status" aria-live="polite">
        <p style={{ margin: '0 0 6px' }}>
          <span className="spinner" aria-hidden="true" />{' '}
          {stage === 'loading'
            ? 'Getting the bill reader ready… (the first time takes a few seconds)'
            : `Reading the bill… ${percent}%`}
        </p>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.max(8, percent)}%` }} />
        </div>
      </div>
    )
  }

  if (read.status === 'failed') {
    return (
      <p className="notice" role="alert">
        Could not read this file: {read.message} Type the amount below instead.
      </p>
    )
  }

  const { result } = read
  const [best, ...others] = result.candidates
  return (
    <div className="read-result" aria-live="polite">
      {best ? (
        <p className="read-found">
          ✓ Found the total: <strong>{formatCents(best.cents)}</strong> from “{best.line}”. Check it
          or adjust below before adding the bill.
        </p>
      ) : (
        <p className="notice">
          No total found on this bill. Type the amount below. The file will still be saved with the
          bill.
        </p>
      )}
      {others.length > 0 && (
        <div className="candidates">
          <span className="muted small">Other amounts on the bill:</span>
          {others.map((c) => (
            <button
              key={c.cents}
              type="button"
              className="chip"
              title={c.line}
              onClick={() => onPick(c)}
            >
              {formatCents(c.cents)}
            </button>
          ))}
        </div>
      )}
      <details>
        <summary className="muted small">
          Text read from the bill ({result.method === 'ocr' ? 'OCR' : 'PDF text'})
        </summary>
        <pre className="read-text">{result.text.trim() || '(no text found)'}</pre>
      </details>
    </div>
  )
}
