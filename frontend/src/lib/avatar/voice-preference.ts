"use client"

import { useSyncExternalStore } from "react"

/**
 * Voz da INIA silenciada (botão de mudo) — preferência DESTE navegador, a mesma no painel e na sessão de feedback. Padrão: ela
 * fala, inclusive as respostas ao que é digitado. Muda, ela responde só em texto (no palco, o texto passa pelo balão sem ela
 * mexer a boca). Sem armazenamento disponível (janela privada, bloqueio), vale só enquanto a página está aberta.
 */
const STORAGE_KEY = "inia.voice.muted"
const listeners = new Set<() => void>()
let cached: boolean | null = null

export function readVoiceMuted(): boolean {
  if (cached !== null) return cached
  try {
    cached = window.localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    cached = false
  }
  return cached
}

export function setVoiceMuted(muted: boolean): void {
  cached = muted
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0")
  } catch {
    // Sem armazenamento: vale para esta página.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVoiceMuted(): boolean {
  return useSyncExternalStore(subscribe, readVoiceMuted, () => false)
}

/** Testes: esquece o valor lido (o armazenamento do jsdom sobrevive entre testes do mesmo arquivo). */
export function resetVoicePreferenceForTests(): void {
  cached = null
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
