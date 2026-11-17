import { z } from "zod"
import { presenceStatusSchema } from "./catalogs.schema"

/** Espelho das respostas da configuração do Apoio com Anjo (Administrador geral; `/api/v1/admin/human-support`). */
export const settingsViewSchema = z.object({ enabled: z.boolean(), defaultCapacity: z.number(), version: z.number() })
export type SettingsView = z.infer<typeof settingsViewSchema>

/**
 * Tempos de resposta (migration 193; Administrador geral ou Coordenador de Anjos, pelo Painel dos Anjos): o operador sem responder
 * volta à fila de quem aguarda o retorno; sem voltar até o encerramento, abandono do operador; o Anjo sem responder perde o atendimento.
 */
export const RESPONSE_TIMES_LIMITS = { requeueMin: 1, requeueMax: 120, closeMax: 240 } as const
export const ANJO_UNRESPONSIVE_LIMITS = { pauseAfterMax: 240, offlineAfterMax: 120 } as const
export const responseTimesSchema = z.object({ operatorRequeueMinutes: z.number(), operatorCloseMinutes: z.number(), anjoRequeueMinutes: z.number() })
export type ResponseTimes = z.infer<typeof responseTimesSchema>
/**
 * Tempos de resposta (migrations 193/194): o padrão da organização (só quem acompanha a organização muda) e os de cada Grupo que quem
 * lê alcança (`custom = false` = usa o padrão; `canEdit` = o Coordenador de Anjos do próprio Grupo ou quem acompanha a organização).
 */
export const responseTimesPanelSchema = z.object({
  organization: z.object({
    times: responseTimesSchema,
    /** Anjo sem responder ninguém (195): minutos até a pausa "Desconexão" e minutos nela até Indisponível. Só da organização. */
    anjoUnresponsive: z.object({ pauseAfterMinutes: z.number(), offlineAfterMinutes: z.number() }),
    version: z.number(),
    canEdit: z.boolean(),
  }),
  groups: z.array(z.object({ teamId: z.string(), teamName: z.string(), custom: z.boolean(), times: responseTimesSchema, version: z.number(), canEdit: z.boolean() })),
})
export type ResponseTimesPanel = z.infer<typeof responseTimesPanelSchema>

export const SCOPE_STATES = ["INHERIT", "ON", "OFF"] as const
export const scopeStateSchema = z.enum(SCOPE_STATES)
export type ScopeState = z.infer<typeof scopeStateSchema>
export const SCOPE_STATE_LABELS: Record<ScopeState, string> = { INHERIT: "Herdar", ON: "Ligado", OFF: "Desligado" }

type ScopeNodeShape = {
  type: "GROUP" | "SUBGROUP"
  id: string
  name: string
  state: ScopeState
  effective: boolean
  effectiveSource: "OWN" | "GROUP" | "DEFAULT_OFF" | "MASTER_OFF"
  anjoCount: number
  warnings: "ENABLED_WITHOUT_ANJO"[]
  children?: ScopeNodeShape[] | undefined
}
export const scopeNodeSchema: z.ZodType<ScopeNodeShape> = z.lazy(() =>
  z.object({
    type: z.enum(["GROUP", "SUBGROUP"]),
    id: z.string(),
    name: z.string(),
    state: scopeStateSchema,
    effective: z.boolean(),
    effectiveSource: z.enum(["OWN", "GROUP", "DEFAULT_OFF", "MASTER_OFF"]),
    anjoCount: z.number(),
    warnings: z.array(z.literal("ENABLED_WITHOUT_ANJO")),
    children: z.array(scopeNodeSchema).optional(),
  }),
)
export type ScopeNode = z.infer<typeof scopeNodeSchema>

/** "Ligado (herdado do Grupo)", "Desligado (chave geral)"… — o efetivo e de onde ele vem. */
export function effectiveScopeText(node: Pick<ScopeNode, "effective" | "effectiveSource">): string {
  const state = node.effective ? "Ligado" : "Desligado"
  if (node.effectiveSource === "GROUP") return `${state} (herdado do Grupo)`
  if (node.effectiveSource === "MASTER_OFF") return "Desligado (chave geral desligada)"
  if (node.effectiveSource === "DEFAULT_OFF") return "Desligado (nada ligado acima)"
  return state
}

export const anjoRowSchema = z.object({
  personId: z.string(),
  name: z.string(),
  scopes: z.array(z.object({ type: z.enum(["ORGANIZATION", "GROUP", "SUBGROUP"]), id: z.string().nullable(), name: z.string() })),
  maxConcurrent: z.number().nullable(),
  effectiveCapacity: z.number(),
  status: presenceStatusSchema,
  connected: z.boolean(),
  used: z.number(),
  canReceiveAssignment: z.boolean().nullable(),
  reasonNotEligible: z.enum(["OFFLINE", "PAUSED", "SCHEDULED_CHANGE", "NO_CAPACITY", "NOT_CONNECTED", "SCOPE_NOT_COVERED"]).nullable(),
})
export type AnjoRow = z.infer<typeof anjoRowSchema>
export const NOT_ELIGIBLE_LABELS: Record<NonNullable<AnjoRow["reasonNotEligible"]>, string> = {
  OFFLINE: "Indisponível",
  PAUSED: "Em pausa",
  SCHEDULED_CHANGE: "Pausa ou indisponibilidade programada",
  NO_CAPACITY: "Sem vaga",
  NOT_CONNECTED: "Sem a área do Anjo aberta",
  SCOPE_NOT_COVERED: "Não atende este escopo",
}
