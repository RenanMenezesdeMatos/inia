"use client"

import type { ReactNode } from "react"
import type { UseQueryResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/api-client"
import type { Measure } from "@/schemas/human-support/monitoring.schema"
import type { ComplianceData, FeedbackData, RepliesData, ResponseTimeData, RoutesData, SupportData } from "@/schemas/inia-success/inia-success.schema"

import { BlockState } from "./success-ui"

/** Um bloco de dados da tela: se a conta pode vê-lo e a consulta dele (cada bloco carrega e falha sozinho). */
export type Block<T> = { allowed: boolean; query: UseQueryResult<T, Error> }
export type SuccessBlocks = {
  responseTime: Block<ResponseTimeData>
  routes: Block<RoutesData>
  replies: Block<RepliesData>
  support: Block<SupportData>
  feedback: Block<FeedbackData>
  compliance: Block<ComplianceData>
}

/** De onde vem a permissão de cada bloco (texto do estado "fora do seu acesso"). */
export const DENIED: Record<keyof SuccessBlocks, string> = {
  responseTime: "Este bloco usa a permissão de Conversas com a INIA.",
  routes: "Este bloco usa a permissão de Conversas com a INIA.",
  replies: "As avaliações das respostas da INIA são do painel do Apoio com Anjo (Coordenador de Anjos e Administrador geral).",
  support: "Este bloco usa a permissão do painel do Apoio com Anjo (Coordenador de Anjos e Administrador geral).",
  feedback: "Este bloco usa a permissão de Contestações de feedback.",
  compliance: "A conferência das respostas vale para a organização inteira: só quem administra a configuração em toda a organização a lê.",
}

const errorText = (error: Error) => (error instanceof ApiError && error.status === 422 ? error.message : "Tente de novo em instantes. Os outros blocos continuam valendo.")

/** Corpo de um bloco: sem acesso, carregando, erro (com tentar de novo) ou o conteúdo. */
export function BlockBody<T>({ block, name, lines, children }: { block: Block<T>; name: keyof SuccessBlocks; lines?: number; children: (data: T) => ReactNode }) {
  if (!block.allowed) return <BlockState kind="denied" message={DENIED[name]} />
  if (block.query.isPending) return <BlockState kind="loading" {...(lines ? { lines } : {})} />
  if (block.query.isError) return <BlockState kind="error" message={errorText(block.query.error)} onRetry={() => void block.query.refetch()} />
  return <>{children(block.query.data)}</>
}

export const measureOf = (measures: readonly Measure[], id: string) => measures.find((measure) => measure.id === id) ?? null
