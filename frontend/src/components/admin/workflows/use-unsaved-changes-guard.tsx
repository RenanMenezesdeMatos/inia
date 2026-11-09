"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/** Link que sai desta tela na mesma aba. Nova aba, âncora, download e clique com modificador não perdem nada. */
export function internalNavigationTarget(event: MouseEvent, currentHref: string): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return null
  const destination = new URL(anchor.href, currentHref)
  const current = new URL(currentHref)
  if (destination.origin !== current.origin) return null
  if (destination.pathname === current.pathname && destination.search === current.search) return null
  return `${destination.pathname}${destination.search}${destination.hash}`
}

/**
 * Sair do editor com alterações não salvas pergunta antes. Recarregar ou fechar usa o aviso do próprio navegador; links internos
 * abrem o diálogo. O botão Voltar do navegador, numa navegação interna, não tem como ser interrompido daqui.
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    if (!dirty) return
    function warnOnUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    function interceptLinks(event: MouseEvent) {
      const href = internalNavigationTarget(event, window.location.href)
      if (!href) return
      event.preventDefault()
      event.stopPropagation()
      setPendingHref(href)
    }
    window.addEventListener("beforeunload", warnOnUnload)
    document.addEventListener("click", interceptLinks, true)
    return () => {
      window.removeEventListener("beforeunload", warnOnUnload)
      document.removeEventListener("click", interceptLinks, true)
    }
  }, [dirty])

  return (
    <AlertDialog open={pendingHref !== null} onOpenChange={(open) => !open && setPendingHref(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
          <AlertDialogDescription>As alterações feitas no fluxo desde a última vez que você salvou serão perdidas.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              const href = pendingHref
              setPendingHref(null)
              if (href) router.push(href)
            }}
          >
            Sair sem salvar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
