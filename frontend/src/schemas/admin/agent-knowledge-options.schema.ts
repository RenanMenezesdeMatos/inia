import { z } from "zod"

import { operatingUniverseSchema } from "@/schemas/operating-universe/operating-universe.schema"

/** Situação da base para o agente: em uso (versão publicada), arquivada (inativa) ou ainda sem versão pronta. */
export const knowledgeOptionStateSchema = z.enum(["IN_USE", "ARCHIVED", "NO_VERSION"])
export type KnowledgeOptionState = z.infer<typeof knowledgeOptionStateSchema>

/** Linha leve do seletor de bases do Agent (`/admin/agents/knowledge-options`): só o que a escolha precisa, sem conteúdo. */
export const knowledgeOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  operatingUniverse: operatingUniverseSchema.nullable(),
  state: knowledgeOptionStateSchema,
  inUseVersion: z.number().nullable(),
  orgScopes: z.array(z.object({ scopeType: z.string(), teamId: z.string().nullable(), teamName: z.string().nullable(), subteamId: z.string().nullable(), subteamName: z.string().nullable() })),
  allSubjects: z.boolean(),
  subjects: z.array(z.string()),
  products: z.array(z.string()),
})
export type KnowledgeOption = z.infer<typeof knowledgeOptionSchema>

export const knowledgeOptionsPageSchema = z.object({ items: z.array(knowledgeOptionSchema), nextCursor: z.string().nullable(), total: z.number().nullable() })
export type KnowledgeOptionsPage = z.infer<typeof knowledgeOptionsPageSchema>

export const knowledgeOptionIdsSchema = z.object({ ids: z.array(z.string()), total: z.number(), truncated: z.boolean() })
export type KnowledgeOptionIds = z.infer<typeof knowledgeOptionIdsSchema>

export const knowledgeOptionFacetsSchema = z.object({
  products: z.array(z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable(), parentName: z.string().nullable() })),
  subjects: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type KnowledgeOptionFacets = z.infer<typeof knowledgeOptionFacetsSchema>

/**
 * Alcance do agente que o seletor respeita (o salvar recusa base que não é de nenhum Grupo dele): todos os Grupos, os vínculos (249:
 * Grupo inteiro ou um Subgrupo — o Grupo-pai pode vir vazio, o servidor o acha) ou o formato antigo de vínculo único.
 */
export type AgentKnowledgeScope =
  | { scopeType: "ALL_TEAMS" }
  | { scopeType: "GROUPS"; links: { teamId: string | null; subteamId: string | null }[] }
  | { scopeType: "TEAM"; teamId: string }
  | { scopeType: "SUBTEAM"; subteamId: string; teamId?: string }

/** Filtros do seletor (os mesmos no servidor para a lista e para "selecionar as filtradas"). */
export type KnowledgeOptionsFilter = {
  search?: string
  agentUniverse?: string
  universe?: string
  agentScope?: AgentKnowledgeScope
  scopeType?: "ALL_TEAMS"
  teamId?: readonly string[] | undefined
  subteamId?: readonly string[] | undefined
  productId?: string
  subjectScopeType?: "ALL_SUBJECTS"
  subjectId?: string
  state?: KnowledgeOptionState
  excludeIds?: string[]
}
