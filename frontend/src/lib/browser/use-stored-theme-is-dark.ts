"use client"

import { useSyncExternalStore } from "react"

/** Chave e valores que o `next-themes` grava (ThemeProvider em `app/providers.tsx`: `attribute="class"`, padrão `system`). */
const THEME_STORAGE_KEY = "theme"

/** Tema escuro? "dark"/"light" escolhidos pela pessoa valem; "system", vazio ou desconhecido seguem o sistema operacional. */
export function isDarkTheme(stored: string | null, systemPrefersDark: boolean): boolean {
  if (stored === "dark") return true
  if (stored === "light") return false
  return systemPrefersDark
}

function readStoredTheme(): boolean {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    // Armazenamento bloqueado (janela privada, política do navegador): segue o sistema.
  }
  return isDarkTheme(stored, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false)
}

const noSubscription = () => () => {}

/**
 * Para telas que renderizam FORA do ThemeProvider (ex.: `app/global-error.tsx`, que troca o documento inteiro): lê o tema que o
 * `next-themes` guardou. No servidor e na hidratação é `false` (claro), como a página de erro padrão; no cliente, o tema real.
 */
export function useStoredThemeIsDark(): boolean {
  return useSyncExternalStore(noSubscription, readStoredTheme, () => false)
}
