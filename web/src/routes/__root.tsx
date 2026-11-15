import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ApiStatus } from '../ApiStatus'

export const Route = createRootRoute({
  component: () => (
    <div className="app-shell">
      <div className="ambient-orb ambient-orb-1" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-2" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-3" aria-hidden="true" />
      <ApiStatus />
      <Outlet />
    </div>
  ),
})
