import { Hono } from 'hono'
import { ApiError } from './lib/errors'
import type { AppEnv } from './lib/types'
import { API_VERSION } from './lib/version'
import { attachments } from './routes/attachments'
import { bills } from './routes/bills'
import { homes } from './routes/homes'

const app = new Hono<AppEnv>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.get('/api/version', (c) => c.json({ version: API_VERSION }))
// Opening the API port in a browser explains where the app is, instead of a bare 404.
app.get('/', (c) =>
  c.json({ status: 'ok', message: 'Bill Splitter API. Open the web app at http://localhost:5173' }),
)
app.route('/api/homes', homes)
app.route('/api', bills)
app.route('/api', attachments)

// Every error leaves the API as JSON: { "error": "message" }.
app.notFound((c) => c.json({ error: 'route not found' }, 404))

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status)
  }
  // Unknown failures are logged with detail but answered with a generic message,
  // so database internals never leak to the client.
  console.error('unhandled error', err)
  return c.json({ error: 'internal server error' }, 500)
})

export default app
