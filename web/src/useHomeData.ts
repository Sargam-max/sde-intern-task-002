import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Balance, type Bill, type Home, type Member, type Share } from './api'

export type HomeData = { home: Home; bills: Bill[]; balances: Balance[] }

export type HomeDataState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: HomeData; refreshError: string | null }

const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

/**
 * Loads a home, its bills and the balances together.
 * - `retry()` starts over and shows the loading state (used after a failed first load).
 * - `refresh()` reloads quietly and keeps the current data on screen if it fails.
 * Requests are cancelled when the page goes away, and stale answers are ignored.
 */
export function useHomeData(homeId: string) {
  const [state, setState] = useState<HomeDataState>({ status: 'loading' })
  const latest = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const load = useCallback(
    async (quiet: boolean) => {
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort
      const requestId = ++latest.current
      if (!quiet) setState({ status: 'loading' })

      try {
        const [home, bills, balances] = await Promise.all([
          api.getHome(homeId, abort.signal),
          api.listBills(homeId, abort.signal),
          api.getBalances(homeId, abort.signal),
        ])
        if (requestId !== latest.current) return
        setState({ status: 'ready', data: { home, bills, balances }, refreshError: null })
      } catch (err) {
        if (abort.signal.aborted || requestId !== latest.current) return
        setState((current) =>
          quiet && current.status === 'ready'
            ? { ...current, refreshError: messageOf(err) }
            : { status: 'error', message: messageOf(err) },
        )
      }
    },
    [homeId],
  )

  useEffect(() => {
    void load(false)
    return () => controller.current?.abort()
  }, [load])

  /** Puts a freshly paid share on screen right away, before the quiet refresh lands. */
  const applyPaidShare = useCallback((billId: string, paid: Share) => {
    setState((current) => {
      if (current.status !== 'ready') return current
      const bills = current.data.bills.map((bill) =>
        bill.id !== billId
          ? bill
          : { ...bill, shares: bill.shares.map((s) => (s.id === paid.id ? paid : s)) },
      )
      return { ...current, data: { ...current.data, bills } }
    })
  }, [])

  /** Shows a freshly added member right away, before quiet refresh lands. */
  const addMemberLocally = useCallback((member: Member) => {
    setState((current) => {
      if (current.status !== 'ready') return current
      if (current.data.home.members.some((m) => m.id === member.id)) return current
      return {
        ...current,
        data: {
          ...current.data,
          home: {
            ...current.data.home,
            members: [...current.data.home.members, member],
          },
          balances: current.data.balances.some((b) => b.memberId === member.id)
            ? current.data.balances
            : [
                ...current.data.balances,
                { memberId: member.id, name: member.name, outstandingCents: 0 },
              ],
        },
      }
    })
  }, [])

  return {
    state,
    retry: useCallback(() => load(false), [load]),
    refresh: useCallback(() => load(true), [load]),
    applyPaidShare,
    addMemberLocally,
  }
}
