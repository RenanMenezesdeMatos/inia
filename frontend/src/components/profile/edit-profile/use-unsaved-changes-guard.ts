"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * Proteção contra descarte acidental enquanto há alterações não salvas:
 * - recarregar/fechar a aba → aviso nativo do navegador (`beforeunload`);
 * - clicar em qualquer link interno (cabeçalho, marca, menus) → a navegação espera a confirmação;
 * - voltar do navegador → uma entrada-sentinela na história segura a página até a confirmação.
 * `confirm()` executa a saída pendente; `cancel()` continua editando. `release()` desliga tudo (ex.: depois de salvar).
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [released, setReleased] = useState(false)
  const active = dirty && !released
  const bypassPop = useRef(false)

  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [active])

  useEffect(() => {
    if (!active) return
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      // Captura no documento: a navegação do link (inclusive do Next) nem começa.
      event.preventDefault()
      event.stopPropagation()
      setPending(() => () => router.push(`${url.pathname}${url.search}${url.hash}`))
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [active, router])

  useEffect(() => {
    if (!active) return
    window.history.pushState(window.history.state, "", window.location.href)
    const onPopState = () => {
      if (bypassPop.current) return
      window.history.pushState(window.history.state, "", window.location.href)
      setPending(() => () => {
        bypassPop.current = true
        window.history.go(-2)
      })
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [active])

  return {
    /** Diálogo de confirmação aberto. */
    open: pending !== null,
    /** Pede para sair: com alterações, abre a confirmação; sem, sai direto. */
    request: (leave: () => void) => (active ? setPending(() => leave) : leave()),
    confirm: () => {
      const leave = pending
      setPending(null)
      setReleased(true)
      leave?.()
    },
    cancel: () => setPending(null),
    release: () => setReleased(true),
  }
}
