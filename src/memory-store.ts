import type { CheckAndReserveParams, PolicyStore, ReservationResult } from "./types.js"

interface WindowEntry {
  total: bigint
  windowStart: number
}

interface Reservation {
  key: string
  amount: bigint
  committed: boolean
}

export function createMemoryStore(): PolicyStore {
  const windows = new Map<string, WindowEntry>()
  const reservations = new Map<string, Reservation>()

  function getOrCreateWindow(key: string, windowMs: number, now: number): WindowEntry {
    const existing = windows.get(key)
    if (existing && now - existing.windowStart < windowMs) {
      return existing
    }
    const entry: WindowEntry = { total: 0n, windowStart: now }
    windows.set(key, entry)
    return entry
  }

  return {
    async checkAndReserve(params: CheckAndReserveParams): Promise<ReservationResult> {
      const { key, amount, limit, windowMs, idempotencyKey } = params

      const existingReservation = reservations.get(idempotencyKey)
      if (existingReservation) {
        const window = getOrCreateWindow(key, windowMs, Date.now())
        return {
          allowed: true,
          currentTotal: window.total,
          windowResetAt: new Date(window.windowStart + windowMs),
        }
      }

      const now = Date.now()
      const window = getOrCreateWindow(key, windowMs, now)

      if (window.total + amount > limit) {
        return {
          allowed: false,
          currentTotal: window.total,
          windowResetAt: new Date(window.windowStart + windowMs),
        }
      }

      window.total += amount
      reservations.set(idempotencyKey, { key, amount, committed: false })

      return {
        allowed: true,
        currentTotal: window.total,
        windowResetAt: new Date(window.windowStart + windowMs),
      }
    },

    async commit(idempotencyKey: string): Promise<void> {
      const reservation = reservations.get(idempotencyKey)
      if (reservation) {
        reservation.committed = true
      }
    },

    async release(idempotencyKey: string): Promise<void> {
      const reservation = reservations.get(idempotencyKey)
      if (!reservation || reservation.committed) {
        return
      }

      const window = windows.get(reservation.key)
      if (window) {
        window.total -= reservation.amount
        if (window.total < 0n) {
          window.total = 0n
        }
      }

      reservations.delete(idempotencyKey)
    },
  }
}
