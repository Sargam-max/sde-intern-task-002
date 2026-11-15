import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ApiStatus } from '../ApiStatus'

export const Route = createRootRoute({
  component: () => (
    <>
      <ApiStatus />
      <Outlet />
    </>
  ),
})
