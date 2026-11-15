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
      setError('Enter a name for the home.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const home = await api.createHome(name)
      await navigate({ to: '/homes/$homeId', params: { homeId: home.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the home.')
      setBusy(false)
    }
  }

  return (
    <main className="page page-start">
      {/* Brand Hero Header */}
      <header className="hero-header">
        <div className="hero-badge">
          <span className="badge-sparkle">✨</span> Cloudflare D1 · Zero Rounding Drift
        </div>
        <div className="brand-logo">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">BillSplitter</span>
        </div>
        <h1>Shared expenses made exact.</h1>
        <p className="hero-subtitle">
          Fair, transparent bill splitting for shared households. Zero rounding errors, atomic
          concurrency safety, and instant in-browser OCR.
        </p>
      </header>

      <div className="start-grid">
        {/* Create Home Card */}
        <section className="card start-card">
          <div className="card-header">
            <h2>Create a Home</h2>
            <span className="card-badge">Instant Setup</span>
          </div>
          <p className="muted small" style={{ margin: '0 0 16px' }}>
            Set up a household for your apartment, dorm, or flatmates.
          </p>
          <form className="create-home-form" onSubmit={create}>
            <label className="sr-only" htmlFor="home-name">
              Home name
            </label>
            <div className="input-with-button">
              <input
                id="home-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Home name, e.g. Flat 4B, Baker St."
                maxLength={100}
                disabled={busy}
              />
              <button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create Home →'}
              </button>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>

        {/* Existing Homes List */}
        <section className="card start-card">
          <div className="card-header">
            <h2>Your Households</h2>
            {state.status === 'ready' && <span className="pill-badge">{state.homes.length}</span>}
          </div>

          {state.status === 'loading' && (
            <div className="loading-box" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>Loading households…</span>
            </div>
          )}

          {state.status === 'error' && (
            <div className="alert" role="alert">
              <strong>Could not load your homes.</strong> {state.message}
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
                <span className="muted small">Create your first household using the form.</span>
              </div>
            ) : (
              <ul className="home-grid-list">
                {state.homes.map((home) => (
                  <li key={home.id}>
                    <Link
                      to="/homes/$homeId"
                      params={{ homeId: home.id }}
                      className="home-card-link"
                    >
                      <div className="home-card-left">
                        <span className="home-avatar">🏠</span>
                        <div>
                          <span className="home-card-name">{home.name}</span>
                          <span className="home-card-stats">
                            {home.memberCount} {home.memberCount === 1 ? 'member' : 'members'} ·{' '}
                            {home.billCount} {home.billCount === 1 ? 'bill' : 'bills'}
                          </span>
                        </div>
                      </div>
                      <span className="home-card-arrow">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </div>
    </main>
  )
}
