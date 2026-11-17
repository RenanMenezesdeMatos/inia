"use client"

import { createContext, useContext } from "react"

import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

/**
 * Universo de atuação do Workflow em edição (o do RASCUNHO — vale ao Publicar). Os seletores do grafo (agente, Orquestrador, indicador,
 * indicador do gatilho) só oferecem o que é desse universo — hierarquia universo → recursos. `undefined` = ainda não conhecido (sem
 * filtro); `null` = Workflow pendente, que cabe em qualquer universo. A referência já salva de outro universo continua visível e
 * marcada; o publish recusa (`assertWorkflowGraphUniverse` no backend).
 */
const WorkflowUniverseContext = createContext<OperatingUniverse | null | undefined>(undefined)

export const WorkflowUniverseProvider = WorkflowUniverseContext.Provider

export function useWorkflowUniverse(): OperatingUniverse | null | undefined {
  return useContext(WorkflowUniverseContext)
}
