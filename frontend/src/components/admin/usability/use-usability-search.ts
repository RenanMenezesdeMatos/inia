"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { toHref } from "./usability-url-state"

type Pending = { asked: string; known: readonly string[] }

/**
 * Recorte da tela na URL, sem esperar a navegação: `router.replace` só muda o endereço depois, e duas marcas seguidas (dois Grupos)
 * partiriam do endereço velho, perdendo a primeira. O último pedido vale até o endereço CONFIRMADO chegar nele. No caminho o endereço
 * passa pelos pedidos anteriores e pode voltar ao de partida (o Next descarta a navegação que outra substituiu; no WebKit isso acontece
 * quase sempre): esses são conhecidos. Endereço desconhecido é navegação de fora (voltar, link) e manda.
 */
export function useUsabilitySearch() {
  const router = useRouter()
  const pathname = usePathname()
  const url = useSearchParams().toString()
  const [pending, setPending] = useState<Pending | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- só o endereço CONFIRMADO (depois do commit) solta o pedido; no render ele oscila
    setPending((current) => (current && (url === current.asked || !current.known.includes(url)) ? null : current))
  }, [url])
  useEffect(() => {
    const leave = () => setPending(null)
    window.addEventListener("popstate", leave)
    return () => window.removeEventListener("popstate", leave)
  }, [])
  const current = pending?.asked ?? url
  const search = useMemo(() => new URLSearchParams(current), [current])
  function navigate(next: URLSearchParams) {
    const asked = next.toString()
    setPending((previous) => (!previous && asked === url ? null : { asked, known: [...(previous?.known ?? [url]), asked] }))
    router.replace(toHref(pathname, next), { scroll: false })
  }
  return { search, navigate }
}
