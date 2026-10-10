import { z } from "zod"

/**
 * Tamanho dos campos de texto do Agent — fonte única no backend (rotas de criar/editar).
 * Espelho no frontend: `frontend/src/schemas/admin/agent.schema.ts › AGENT_TEXT_LIMITS`
 * (teste de sincronia em agent-field-limits.test.ts).
 *
 * Contado em caracteres DEPOIS do trim (o mesmo `length` do JavaScript que o contador da tela usa).
 * O prompt cabe o maior contexto existente na base (≈ 10,8 mil) com folga; ele entra no prompt de
 * sistema junto com trechos da base, regras e restrições, então não é texto livre sem custo.
 */
export const AGENT_TEXT_LIMITS = {
  name: { label: "Nome", min: 2, max: 120 },
  objective: { label: "Objetivo", min: 5, max: 1_000 },
  description: { label: "Descrição", min: 5, max: 2_000 },
  contextPrompt: { label: "Contexto (prompt)", min: 10, max: 12_000 },
  capability: { label: "Competência", min: 0, max: 80 },
} as const

export type AgentTextField = keyof typeof AGENT_TEXT_LIMITS

const formatCount = (value: number) => value.toLocaleString("pt-BR")

/** Texto do Agent com os limites do campo e mensagens em português (detalhes do 400 VALIDATION_ERROR). */
export function agentTextSchema(field: AgentTextField) {
  const { label, min, max } = AGENT_TEXT_LIMITS[field]
  const base = z.string().trim()
  const withMin = min > 0 ? base.min(min, `${label}: mínimo de ${formatCount(min)} caracteres.`) : base
  return withMin.max(max, `${label}: máximo de ${formatCount(max)} caracteres.`)
}
