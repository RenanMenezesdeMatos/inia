"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { arrivedAtAuthBySoftNavigation, loadSessionDocument } from "@/lib/auth/session-navigation"

/**
 * FRONTEIRA DE SESSÃO no DESTINO: as telas de acesso nunca reaproveitam o documento de uma sessão. Quando a pessoa chega aqui
 * pelo roteador vindo de outra área (sessão encerrada no servidor — os redirects das páginas e do proxy), o cache do React
 * Query é limpo e a página é carregada de novo, substituindo a entrada do histórico: o cache do roteador do Next vai junto e o
 * Voltar não mostra mais as páginas da conta anterior (complemento do C08, achado de 10/11/2026).
 */
export function SessionDocumentBoundary() {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!arrivedAtAuthBySoftNavigation()) return
    queryClient.clear()
    loadSessionDocument(window.location.href, { replace: true })
  }, [queryClient])
  return null
}
