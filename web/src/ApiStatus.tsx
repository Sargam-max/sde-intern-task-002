import { useEffect, useState } from 'react'
import { ApiError, api, EXPECTED_API_VERSION } from './api'

type Status = 'checking' | 'ok' | 'unreachable' | 'outdated'

/**
 * Checks once that the page can talk to the right API. The two problems it catches are
 * the usual reasons for "nothing saves": the API is not running, or an old API process
 * from an earlier copy of the project is still holding port 8787.
 */
export function ApiStatus() {
  const [status, setStatus] = useState<Status>('checking')
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the check
  useEffect(() => {
    const abort = new AbortController()
    api
      .getVersion(abort.signal)
      .then((version) => setStatus(version === EXPECTED_API_VERSION ? 'ok' : 'outdated'))
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        // A 404 means an API answered but has no /api/version: an older copy.
        setStatus(err instanceof ApiError && err.status === 404 ? 'outdated' : 'unreachable')
      })
    return () => abort.abort()
  }, [attempt])

  if (status === 'checking' || status === 'ok') return null

  return (
    <div className="api-banner" role="alert">
      {status === 'unreachable' ? (
        <>
          <strong>Cannot reach the API.</strong> Check that <code>pnpm dev</code> is running and
          that its output says <code>Ready on http://127.0.0.1:8787</code>.
        </>
      ) : (
        <>
          <strong>An older version of the API is running on port 8787.</strong> Stop every terminal
          running <code>pnpm dev</code> (Ctrl+C), then start it again in this folder.
        </>
      )}{' '}
      <button type="button" className="link" onClick={() => setAttempt((n) => n + 1)}>
        Check again
      </button>
    </div>
  )
}
