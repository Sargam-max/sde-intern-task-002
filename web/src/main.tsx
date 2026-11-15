import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'
import './styles.css'

const router = createRouter({
  routeTree,
  // Last line of defence: if a render ever throws, show a message instead of a blank page.
  defaultErrorComponent: ({ error, reset }) => (
    <main className="page">
      <div className="alert" role="alert">
        <strong>Something went wrong.</strong>{' '}
        {error instanceof Error ? error.message : 'Please try again.'}
        <div>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </main>
  ),
  defaultNotFoundComponent: () => (
    <main className="page">
      <p>Page not found.</p>
    </main>
  ),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element missing')

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
