"use client"

import { useEffect, useState } from "react"

/**
 * Verdadeiro por `durationMs` a partir de cada novo `stamp` (ex.: cada resposta da chamada de estado que diz "digitando por 6 s").
 * `null` ou ≤ 0 = falso. Sem estado gravado no efeito: o temporizador só registra qual `stamp` venceu.
 */
export function useExpiringFlag(durationMs: number | null, stamp: unknown): boolean {
  const [expired, setExpired] = useState<unknown>(undefined)
  useEffect(() => {
    if (durationMs === null || durationMs <= 0) return
    const timer = setTimeout(() => setExpired(() => stamp), durationMs)
    return () => clearTimeout(timer)
  }, [durationMs, stamp])
  return durationMs !== null && durationMs > 0 && expired !== stamp
}
