import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ApiStatus } from '../ApiStatus'
import { TopNavbar } from '../components/TopNavbar'

function RootComponent() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bill-splitter-theme')
      if (saved === 'dark' || saved === 'light') return saved
      // Default to dark for premium fintech aesthetic, or follow system
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'dark'
    }
    return 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('bill-splitter-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
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
