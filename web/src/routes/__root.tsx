import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ApiStatus } from '../ApiStatus'
import { TopNavbar } from '../components/TopNavbar'

function RootComponent() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bill-splitter-theme-v2')
      if (saved === 'light' || saved === 'dark') return saved
      // Default to cool light theme as requested
      return 'light'
    }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('bill-splitter-theme-v2', theme)
    localStorage.setItem('bill-splitter-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <div className="ambient-orb ambient-orb-1" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-2" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-3" aria-hidden="true" />
      <TopNavbar theme={theme} onToggleTheme={toggleTheme} />
      <ApiStatus />
      <Outlet />
    </div>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
