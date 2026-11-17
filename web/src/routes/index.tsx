import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api, type HomeSummary } from '../api'

export const Route = createFileRoute('/')({
  component: Start,
})

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; homes: HomeSummary[] }

function useHomes() {
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load
  useEffect(() => {
    const abort = new AbortController()
    setState({ status: 'loading' })
    api
      .listHomes(abort.signal)
      .then((homes) => setState({ status: 'ready', homes }))
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not load homes.',
        })
      })
    return () => abort.abort()
  }, [attempt])

  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) }
}

function Start() {
  const navigate = useNavigate()
  const { state, retry } = useHomes()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setError('Please enter a name for the household.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const home = await api.createHome(name)
      await navigate({ to: '/homes/$homeId', params: { homeId: home.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the household.')
      setBusy(false)
    }
  }

  return (
    <main className="page page-start">
      {/* Brand Hero Header */}
      <header className="hero-header">
        <div className="hero-badge">
          <span className="badge-sparkle">✨</span> Cloudflare D1 · Zero Cent Drift Architecture
        </div>
        <h1 className="hero-title-gradient">Shared expenses made exact.</h1>
        <p className="hero-subtitle">
          Fair, transparent expense splitting for shared households. Zero rounding drift, atomic
          concurrency safety, and instant multimodal bill reading.
        </p>

        {/* Hero Quick Create Household Form */}
        <div className="hero-create-container">
          <form className="hero-create-form" onSubmit={create}>
            <label className="sr-only" htmlFor="home-name">
              Household name
            </label>
            <div className="hero-input-group">
              <span className="hero-input-icon">🏠</span>
              <input
                id="home-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter household name (e.g. Baker St, Flat 4B)..."
                maxLength={100}
                disabled={busy}
              />
              <button type="submit" className="hero-btn-create" disabled={busy}>
                {busy ? 'Setting up…' : '+ Create Household →'}
              </button>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </div>

        <div className="hero-feature-pills">
          <span className="feature-pill">🛡️ Mathematical Cent Precision</span>
          <span className="feature-pill">⚡ Atomic D1 SQLite</span>
          <span className="feature-pill">👁️ Smart Receipt Vision</span>
        </div>
      </header>

      {/* Existing Households Grid */}
      <section className="card start-card">
        <div className="card-header">
          <div className="card-header-title-group">
            <h2>Your Households</h2>
            <span className="muted small">Select an expense ledger to view bills & balances</span>
          </div>
          {state.status === 'ready' && (
            <span className="pill-badge">{state.homes.length} active</span>
          )}
        </div>

        {state.status === 'loading' && (
          <div className="loading-box" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>Loading households from D1 SQLite…</span>
          </div>
        )}

        {state.status === 'error' && (
          <div className="alert" role="alert">
            <strong>Could not load households.</strong> {state.message}
            <div style={{ marginTop: '10px' }}>
              <button type="button" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        )}

        {state.status === 'ready' &&
          (state.homes.length === 0 ? (
            <div className="empty-compact">
              <span className="empty-icon-small">🏠</span>
              <p>No households created yet.</p>
              <span className="muted small">
                Enter a household name in the bar above to launch your first ledger.
              </span>
            </div>
          ) : (
            <div className="home-grid-cards">
              {state.homes.map((home) => (
                <Link
                  key={home.id}
                  to="/homes/$homeId"
                  params={{ homeId: home.id }}
                  className="home-card-item"
                >
                  <div className="home-card-item-top">
                    <div className="home-avatar-squircle">🏠</div>
                    <div className="home-card-item-meta">
                      <span className="home-card-name">{home.name}</span>
                      <span className="home-card-id-sub">ID: {home.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  <div className="home-card-item-bottom">
                    <div className="home-card-chips">
                      <span className="home-chip">
                        👥 {home.memberCount} {home.memberCount === 1 ? 'member' : 'members'}
                      </span>
                      <span className="home-chip">
                        🧾 {home.billCount} {home.billCount === 1 ? 'bill' : 'bills'}
                      </span>
                    </div>
                    <span className="home-card-cta">
                      Open Ledger <span className="home-card-cta-arrow">→</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ))}
      </section>

      {/* Feature Highlights Grid */}
      <section className="features-grid">
        <div className="feature-card">
          <div className="feature-card-icon">🛡️</div>
          <h3>Zero Cent Drift</h3>
          <p>
            When dividing ₹100 among 3 roommates, standard floating math produces ₹33.333... and
            loses a cent. BillSplitter's deterministic integer math allocates remaining cents in
            join order so the sum always matches 100.00%.
          </p>
        </div>
        <div className="feature-card">
          <div className="feature-card-icon">⚡</div>
          <h3>Atomic D1 Concurrency</h3>
          <p>
            Built on Cloudflare Workers and D1 SQLite with strict transaction locks. If two
            roommates click "Pay Share" at the exact same millisecond, idempotency keys ensure no
            double charges or split collisions.
          </p>
        </div>
        <div className="feature-card">
          <div className="feature-card-icon">👁️</div>
          <h3>Multimodal AI & OCR</h3>
          <p>
            Upload any PDF invoice, supermarket receipt, or utility statement. In-browser Tesseract
            WASM and backend Gemini AI Vision instantly extract total payable amounts with zero
            manual typing.
          </p>
        </div>
      </section>
    </main>
  )
}
