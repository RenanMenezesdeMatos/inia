"use client"

import { useSyncExternalStore } from "react"

/** A pessoa fechou o próprio quadro na chamada? Escolha deste navegador (como o mudo): vale para as próximas chamadas, até ela reabrir. */
const STORAGE_KEY = "inia.call.self-view-hidden"
const listeners = new Set<() => void>()
/** Sem armazenamento (navegação privada, bloqueio): vale só nesta página. */
let memory: boolean | null = null

function read(): boolean {
  if (memory !== null) return memory
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function setSelfViewHidden(hidden: boolean): void {
  memory = hidden
  try {
    if (hidden) window.localStorage.setItem(STORAGE_KEY, "1")
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Fica só em memória.
  }
  for (const listener of listeners) listener()
}

export function resetSelfViewForTests(): void {
  memory = null
}

export function useSelfViewHidden(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => false,
  )
}
