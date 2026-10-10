"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import type { ColorMode } from "@xyflow/react"

const subscribeNever = () => () => {}

/**
 * Tema do React Flow sincronizado com o tema da aplicação (next-themes). Sem isto os controles
 * de zoom (`<Controls />`) e o minimapa ficam com o fundo branco padrão da biblioteca no modo
 * escuro — um retângulo branco sem ícones visíveis no canto do canvas (achado do QA visual do
 * editor de Workflows/Orquestradores). Retorna "light" no servidor e na hidratação para o HTML
 * do servidor e o do cliente serem idênticos (mesmo padrão do ModeToggle).
 */
export function useReactFlowColorMode(): ColorMode {
  const { resolvedTheme } = useTheme()
  const onClient = useSyncExternalStore(subscribeNever, () => true, () => false)
  if (!onClient) return "light"
  return resolvedTheme === "dark" ? "dark" : "light"
}
