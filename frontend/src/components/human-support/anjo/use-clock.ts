"use client"

import { useEffect, useState } from "react"

/** Relógio da área do Anjo ("Sem resposta há N min", "Encerrar: operador sem a INIA aberta" após 5 min): o instante atual, a cada `intervalMs`. */
export function useClock(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Minutos inteiros entre um instante ISO e agora (nunca negativo). */
export function minutesSince(iso: string, now: number): number {
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return 0
  return Math.max(0, Math.floor((now - at) / 60_000))
}

/** Instante ISO em ms, ou null quando ausente ou inválido (nunca inventa um início). */
export function instantOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const at = new Date(iso).getTime()
  return Number.isNaN(at) ? null : at
}

/**
 * Tempo decorrido desde `startIso`, contado pelo relógio do SERVIDOR (`clockOffsetMs`) e atualizado a cada segundo — só o componente
 * que usa redesenha. Com `endIso`, a duração fica congelada (sem relógio). Início ausente ou inválido = null: quem mostra diz que não há
 * informação, nunca uma duração inventada. Como o início vem do servidor, atualizar a página ou trocar de aba não reinicia nada.
 */
export function useElapsed(startIso: string | null | undefined, clockOffsetMs = 0, endIso?: string | null): number | null {
  const frozenEnd = instantOf(endIso)
  const now = useClock(frozenEnd === null ? 1_000 : 60 * 60_000)
  const start = instantOf(startIso)
  if (start === null) return null
  const end = frozenEnd ?? now + clockOffsetMs
  return Math.max(0, end - start)
}
