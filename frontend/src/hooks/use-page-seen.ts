"use client"

import { useSyncExternalStore } from "react"

/**
 * A PÁGINA ESTÁ SENDO VISTA: aba visível E janela em foco. Usado para "lida" nas conversas do Apoio com Anjo — com a aba escondida,
 * minimizada ou com outra janela por cima em foco, nada conta como visto. Sem `document` (servidor), nunca vista.
 */
const subscribe = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange)
  window.addEventListener("focus", onChange)
  window.addEventListener("blur", onChange)
  return () => {
    document.removeEventListener("visibilitychange", onChange)
    window.removeEventListener("focus", onChange)
    window.removeEventListener("blur", onChange)
  }
}

export const pageIsSeen = () => document.visibilityState === "visible" && document.hasFocus()

export function usePageSeen(): boolean {
  return useSyncExternalStore(subscribe, pageIsSeen, () => false)
}
