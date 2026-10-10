"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * Pedido de abertura vindo da URL (ex.: `?new=1`, atalho da sidebar para "criar"). `open` vira true na renderização em
 * que a URL passa a trazer o parâmetro, e o parâmetro sai da URL logo depois. A tela CONSOME o pedido com `setOpen(false)`
 * ao agir sobre ele (ou ao navegar, como argument-scripts): assim cada nova navegação com o parâmetro abre de novo —
 * um pedido nunca consumido fica true e a segunda navegação não muda nada.
 */
export function useAutoOpenFromQuery(paramName: string) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  // Abre na renderização em que a URL passa a trazer o parâmetro (ajuste de estado quando a entrada muda, sem render
  // extra). Compara o VALOR: o efeito abaixo tira o parâmetro da URL, então uma nova navegação com ele abre de novo.
  const requested = searchParams.get(paramName)
  const [seenRequest, setSeenRequest] = useState<string | null>(null)
  if (seenRequest !== requested) {
    setSeenRequest(requested)
    if (requested) setOpen(true)
  }

  // Limpar a URL é efeito colateral: continua no efeito.
  useEffect(() => {
    if (searchParams.get(paramName)) router.replace(pathname, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return [open, setOpen] as const
}
