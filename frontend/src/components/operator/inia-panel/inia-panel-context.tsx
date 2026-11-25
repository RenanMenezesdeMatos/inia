"use client"

import { createContext, useContext } from "react"

/**
 * O painel da INIA, visto pelo chat que mora nele: aberto ou recolhido, onde está no documento (para a janela dela encaixar) e os pedidos de
 * abrir e recolher que vêm de fora (aviso do Apoio, "Ler feedback", pergunta de um cartão).
 */
export type IniaPanel = {
  open: boolean
  setOpen(open: boolean): void
  /** Largura para a página ficar ao lado do painel (senão, ele cobre a página e sai ao recolher). */
  wide: boolean
  /** Aviso com o painel recolhido (o Apoio respondeu, há um feedback para conversar). */
  notice: string | null
  panelElement(): HTMLElement | null
  /** O chat registra como abrir e recolher (a janela dela entra na transição). */
  registerActions(actions: { expand(): void; collapse(): void } | null): void
}

export const IniaPanelContext = createContext<IniaPanel | null>(null)

/** `null` fora do perfil (o chat sozinho, sem painel em volta). */
export function useIniaPanel(): IniaPanel | null {
  return useContext(IniaPanelContext)
}
