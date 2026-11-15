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
    <main className="page">
      <h1>Bill Splitter</h1>
      <p className="muted">Split shared bills between the members of a home.</p>

      <section className="card">
        <h2>Create a home</h2>
        <form className="inline-form" onSubmit={create}>
          <label>
            <span className="sr-only">Home name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Home name, e.g. Flat 4B"
              maxLength={100}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

      <section className="card">
        <h2>Your homes</h2>
        {state.status === 'loading' && (
          <p className="muted" role="status">
            <span className="spinner" aria-hidden="true" /> Loading homes…
          </p>
        )}
        {state.status === 'error' && (
          <div className="alert" role="alert">
            <strong>Could not load your homes.</strong> {state.message}
            <div>
              <button type="button" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        )}
        {state.status === 'ready' &&
          (state.homes.length === 0 ? (
            <p className="muted">No homes yet. Create one above.</p>
          ) : (
            <ul className="home-list">
              {state.homes.map((home) => (
                <li key={home.id}>
                  <Link to="/homes/$homeId" params={{ homeId: home.id }}>
                    <span className="name">{home.name}</span>
                    <span className="muted">
                      {home.memberCount} {home.memberCount === 1 ? 'member' : 'members'} ·{' '}
                      {home.billCount} {home.billCount === 1 ? 'bill' : 'bills'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </main>
  )
}
