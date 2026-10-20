"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

import {
  ACTIVITY_EVENT,
  idlePhase,
  LAST_INTERACTION_STORAGE_KEY,
  minutesLeft,
  shouldReportActivity,
} from "@/lib/auth/idle-session"
import { reportSessionActivity } from "@/services/auth/auth-service"

const INTERACTION_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const
const TICK_MS = 10_000
const WARNING_TOAST_ID = "session-idle-warning"

type SessionIdleGuardProps = {
  /** Minutos de inatividade até o encerramento (do /auth/me). 0 = sem encerramento. */
  timeoutMinutes: number
  /** Sessão encerrada por inatividade (aqui ou no servidor). */
  onExpired: () => void
}

/**
 * Mantém viva a sessão de quem está usando a INIA e a encerra depois do tempo parado: avisa o servidor da interação (no máximo
 * uma vez por minuto), mostra um aviso dois minutos antes do fim e, no fim, leva ao login. As abas abertas compartilham a última
 * interação. Não desenha nada além do aviso.
 */
export function SessionIdleGuard({ timeoutMinutes, onExpired }: SessionIdleGuardProps) {
  // Marcados quando o efeito começa (o login acabou de registrar a atividade no servidor).
  const lastInteraction = useRef(0)
  const lastReport = useRef<number | null>(null)
  const expired = useRef(false)
  const onExpiredRef = useRef(onExpired)
  useEffect(() => {
    onExpiredRef.current = onExpired
  }, [onExpired])

  useEffect(() => {
    const timeoutMs = timeoutMinutes * 60_000
    if (timeoutMs <= 0) return
    const startedAt = Date.now()
    lastInteraction.current = startedAt
    lastReport.current = startedAt

    const expire = () => {
      if (expired.current) return
      expired.current = true
      toast.dismiss(WARNING_TOAST_ID)
      onExpiredRef.current()
    }

    const report = () => {
      const now = Date.now()
      if (!shouldReportActivity(lastReport.current, now)) return
      lastReport.current = now
      void reportSessionActivity().then((result) => {
        if (result === "ended") expire()
      }).catch(() => undefined)
    }

    let lastShared = 0
    const markActivity = () => {
      if (expired.current) return
      const now = Date.now()
      lastInteraction.current = now
      toast.dismiss(WARNING_TOAST_ID)
      report()
      if (now - lastShared > 5_000) {
        lastShared = now
        try {
          window.localStorage.setItem(LAST_INTERACTION_STORAGE_KEY, String(now))
        } catch {
          // Sem localStorage (janela privada, bloqueio): cada aba mede a própria interação.
        }
      }
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LAST_INTERACTION_STORAGE_KEY || !event.newValue) return
      const shared = Number(event.newValue)
      if (Number.isFinite(shared) && shared > lastInteraction.current) {
        lastInteraction.current = shared
        toast.dismiss(WARNING_TOAST_ID)
      }
    }

    const tick = () => {
      if (expired.current) return
      const now = Date.now()
      const phase = idlePhase(lastInteraction.current, now, timeoutMs)
      if (phase === "expired") return expire()
      if (phase === "warning") {
        const minutes = minutesLeft(lastInteraction.current, now, timeoutMs)
        toast.warning(`Sua sessão será encerrada por inatividade em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`, {
          id: WARNING_TOAST_ID,
          duration: Infinity,
          action: { label: "Continuar conectado", onClick: () => markActivity() },
        })
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") tick()
    }

    for (const name of INTERACTION_EVENTS) window.addEventListener(name, markActivity, { capture: true, passive: true })
    window.addEventListener(ACTIVITY_EVENT, markActivity)
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", onVisibility)
    const interval = window.setInterval(tick, TICK_MS)
    return () => {
      for (const name of INTERACTION_EVENTS) window.removeEventListener(name, markActivity, { capture: true })
      window.removeEventListener(ACTIVITY_EVENT, markActivity)
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(interval)
      toast.dismiss(WARNING_TOAST_ID)
    }
  }, [timeoutMinutes])

  return null
}
