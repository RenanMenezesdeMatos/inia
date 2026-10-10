"use client"

import { createContext, Suspense, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { useCurrentUserQuery } from "@/queries/auth/use-current-user"

import { detectDevice, UsageCollector } from "./usage-collector"
import { UsageTracker, type ActionHandle } from "./usage-tracker"

/**
 * Liga o rastreador de uso à sessão: UM rastreador por conta, compartilhado (contagem de referências — o Strict Mode monta,
 * desmonta e monta de novo sem criar dois rastreadores nem duas visualizações). Só existe com a coleta ligada no ambiente
 * (`features.usageCollection`, vindo do /auth/me). Trocar de conta encerra o rastreador anterior (fila descartada).
 */
const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"
const APP_VERSION = (process.env.NEXT_PUBLIC_INIA_APP_VERSION ?? "dev").replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 40) || "dev"
const RELEASE_DELAY_MS = 2_000

let shared: { accountId: string; tracker: UsageTracker; refs: number; stopTimer: ReturnType<typeof setTimeout> | null } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function acquire(accountId: string): UsageTracker {
  if (shared && shared.accountId !== accountId) {
    void shared.tracker.logout()
    shared = null
  }
  if (!shared) {
    const collector = new UsageCollector({ apiUrl: API_URL, accountId, appVersion: APP_VERSION, device: detectDevice(), storage: safeStorage("localStorage"), tabStorage: safeStorage("sessionStorage") })
    const tracker = new UsageTracker(collector)
    tracker.start()
    shared = { accountId, tracker, refs: 0, stopTimer: null }
    notify()
  }
  if (shared.stopTimer) clearTimeout(shared.stopTimer)
  shared.stopTimer = null
  shared.refs += 1
  return shared.tracker
}

function release(tracker: UsageTracker) {
  if (!shared || shared.tracker !== tracker) return
  shared.refs -= 1
  if (shared.refs > 0) return
  const current = shared
  current.stopTimer = setTimeout(() => {
    if (shared === current && current.refs === 0) {
      current.tracker.stop()
      shared = null
      notify()
    }
  }, RELEASE_DELAY_MS)
}

function safeStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind]
  } catch {
    return null
  }
}

/** Rastreador ativo (para código fora do React: transporte de voz, serviços). Null = coleta desligada/sem sessão. */
export const getUsageTracker = (): UsageTracker | null => (shared && !shared.tracker.collector.isDisabled ? shared.tracker : null)

/** Logout: fecha a tela, envia o que dá e descarta fila e sessão desta conta (nunca passa para a próxima conta). */
export async function shutdownUsageForLogout() {
  const current = shared
  shared = null
  notify()
  if (current) await current.tracker.logout()
}

const UsageContext = createContext<UsageTracker | null>(null)

export function UsageAnalyticsProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUserQuery().data
  const accountId = user?.sub ?? null
  const enabled = Boolean(user?.features.usageCollection)
  // O rastreador é um recurso externo (compartilhado entre montagens): o efeito só o adquire/libera e a tela o lê pela loja.
  const snapshot = useCallback(() => (enabled && accountId && shared?.accountId === accountId ? shared.tracker : null), [accountId, enabled])
  const tracker = useSyncExternalStore(subscribe, snapshot, () => null)

  useEffect(() => {
    if (!accountId || !enabled) return
    const next = acquire(accountId)
    return () => release(next)
  }, [accountId, enabled])

  return (
    <UsageContext.Provider value={tracker}>
      <Suspense fallback={null}>
        <RouteWatcher tracker={tracker} />
      </Suspense>
      {children}
    </UsageContext.Provider>
  )
}

function RouteWatcher({ tracker }: { tracker: UsageTracker | null }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const query = search.toString()
  useEffect(() => {
    tracker?.routeChanged(pathname, new URLSearchParams(query))
  }, [tracker, pathname, query])
  return null
}

export const useUsageTracker = () => useContext(UsageContext)

const NOOP_ACTION: ActionHandle = { correlationId: "", succeed: () => undefined, fail: () => undefined, cancel: () => undefined }

/** Ação com contrato (iniciada → concluída | falhou | cancelada). Sem coleta, um handle que não faz nada. */
export function startUsageAction(actionKey: string, correlationId?: string): ActionHandle {
  const tracker = getUsageTracker()
  return tracker ? tracker.action(actionKey, correlationId) : NOOP_ACTION
}

/** Evento livre do catálogo (voz, latência, busca). Falha da coleta nunca afeta o fluxo de quem chama. */
export function trackUsage(name: string, properties: Record<string, unknown> = {}, options: Parameters<UsageTracker["track"]>[2] = {}) {
  try {
    getUsageTracker()?.track(name, properties, options)
  } catch {
    // coleta é observacional: nunca derruba o produto
  }
}
