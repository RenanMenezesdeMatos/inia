"use client"

import { useEffect, useState } from "react"

/**
 * `true` depois que a página CARREGOU e o navegador ficou ocioso (requestIdleCallback; sem ele — Safari — um instante depois
 * do `load`), ou na hora em que `now` for verdadeiro (a pessoa já pediu o que dependia disso). Uma vez verdadeiro, nunca volta
 * a falso: quem monta algo caro com isto (o Canvas do avatar 3D) monta UMA vez e nunca é desmontado por esta condição.
 */
type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export function useBrowserIdle(options: { now?: boolean; timeoutMs?: number } = {}): boolean {
  const timeoutMs = options.timeoutMs ?? 3_000
  const [idle, setIdle] = useState(false)
  const [forced, setForced] = useState(false)
  // Pedido explícito: vale já neste render e fica gravado (ajuste de estado durante o render, sem efeito).
  if (options.now && !forced) setForced(true)

  useEffect(() => {
    const win = window as IdleWindow
    let idleHandle: number | null = null
    let timer: number | null = null
    const whenIdle = () => {
      if (win.requestIdleCallback) idleHandle = win.requestIdleCallback(() => setIdle(true), { timeout: timeoutMs })
      else timer = window.setTimeout(() => setIdle(true), 200)
    }
    if (document.readyState === "complete") whenIdle()
    else window.addEventListener("load", whenIdle, { once: true })
    return () => {
      window.removeEventListener("load", whenIdle)
      if (idleHandle !== null) win.cancelIdleCallback?.(idleHandle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [timeoutMs])

  return idle || forced || Boolean(options.now)
}
