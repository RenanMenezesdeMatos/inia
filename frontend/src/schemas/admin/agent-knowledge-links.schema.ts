import { z } from "zod"

import { agentPublishImpactSchema, agentTypeSchema } from "@/schemas/admin/agent.schema"
import { OPERATING_UNIVERSES } from "@/schemas/operating-universe/operating-universe.schema"

/**
 * Associar agentes a partir da base — espelho de `GET|POST /admin/agents/knowledge-links(/preview)` (backend
 * agents/application/agent-knowledge-links.ts). A associação grava no RASCUNHO de cada agente (o mesmo do cadastro do agente) e,
 * se a pessoa escolher, publica — só a mudança de bases: agente com outras alterações pendentes no rascunho fica só no rascunho.
 */
export const knowledgeLinkBlockSchema = z.enum(["SCOPE", "UNIVERSE", "DRAFT_RESTRICTED"])

export const knowledgeLinkCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentType: agentTypeSchema.catch("CUSTOM"),
  active: z.boolean(),
  operatingUniverse: z.string().nullable(),
  /** Alcance em edição (249): ALL_TEAMS ou GROUPS + os vínculos (Grupo inteiro ou um Subgrupo), com os nomes. */
  scopeType: z.string(),
  scopeLinks: z.array(z.object({ teamId: z.string(), teamName: z.string().nullable(), subteamId: z.string().nullable(), subteamName: z.string().nullable() })).catch([]),
  linkedInUse: z.boolean(),
  linkedInDraft: z.boolean(),
  published: z.boolean(),
  currentVersionNumber: z.number().nullable(),
  draft: z.object({
    revision: z.number(),
    pending: z.boolean(),
    otherChanges: z.boolean(),
    updatedAt: z.string().nullable(),
    updatedByName: z.string().nullable(),
  }),
  block: knowledgeLinkBlockSchema.nullable(),
  blockMessage: z.string().nullable(),
})
export type KnowledgeLinkCandidate = z.infer<typeof knowledgeLinkCandidateSchema>

/** Uma página da lista de agentes da base (aba, filtros e página no servidor) e os números das abas. */
export const knowledgeLinksSchema = z.object({
  knowledgeDocument: z.object({ id: z.string(), title: z.string(), operatingUniverse: z.string().nullable() }),
  items: z.array(knowledgeLinkCandidateSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  counts: z.object({ linked: z.number(), available: z.number() }),
  /** Publicados com a base só no rascunho ou só no que a IA usa: "Salvar e publicar" os inclui sem marcar de novo. */
  pendingPublish: z.array(knowledgeLinkCandidateSchema),
})
export type KnowledgeLinks = z.infer<typeof knowledgeLinksSchema>

export const knowledgeLinkModeSchema = z.enum(["DRAFT", "PUBLISH"])
export type KnowledgeLinkMode = z.infer<typeof knowledgeLinkModeSchema>

export const knowledgeLinkOutcomeSchema = z.enum(["UNCHANGED", "DRAFT_SAVED", "PUBLISHED", "DRAFT_ONLY_OTHER_CHANGES"])
export type KnowledgeLinkOutcome = z.infer<typeof knowledgeLinkOutcomeSchema>

/** Teto de agentes por gravação (o servidor recusa acima disso). */
export const MAX_KNOWLEDGE_LINK_CHANGES = 50

export const knowledgeLinkChangeSchema = z.object({ agentId: z.string(), linked: z.boolean(), expectedDraftRevision: z.number() })
export type KnowledgeLinkChange = z.infer<typeof knowledgeLinkChangeSchema>
export const knowledgeLinksRequestSchema = z.object({ knowledgeDocumentId: z.string(), mode: knowledgeLinkModeSchema, changes: z.array(knowledgeLinkChangeSchema) })
export type KnowledgeLinksRequest = z.infer<typeof knowledgeLinksRequestSchema>

export const knowledgeLinkTabSchema = z.enum(["LINKED", "AVAILABLE"])
export type KnowledgeLinkTab = z.infer<typeof knowledgeLinkTabSchema>
export const knowledgeLinkStateSchema = z.enum(["PUBLISHED", "NOT_PUBLISHED", "DRAFT_PENDING", "INACTIVE"])
export type KnowledgeLinkState = z.infer<typeof knowledgeLinkStateSchema>
/** Parâmetros da lista (espelho do `knowledgeLinksQuerySchema` do backend). */
export const knowledgeLinksParamsSchema = z.object({
  knowledgeDocumentId: z.string(),
  tab: knowledgeLinkTabSchema,
  search: z.string().optional(),
  agentType: agentTypeSchema.optional(),
  universe: z.enum([...OPERATING_UNIVERSES, "PENDING"]).optional(),
  scopeType: z.literal("ALL_TEAMS").optional(),
  teamId: z.string().optional(),
  subteamId: z.string().optional(),
  state: knowledgeLinkStateSchema.optional(),
  page: z.number(),
  pageSize: z.number(),
})
export type KnowledgeLinksParams = z.infer<typeof knowledgeLinksParamsSchema>

export const KNOWLEDGE_LINK_STATE_LABELS: Record<KnowledgeLinkState, string> = {
  PUBLISHED: "Publicados e ativos",
  NOT_PUBLISHED: "Nunca publicados",
  DRAFT_PENDING: "Com rascunho pendente",
  INACTIVE: "Inativos",
}

export const knowledgeLinksPreviewSchema = z.object({
  mode: knowledgeLinkModeSchema,
  agents: z.array(z.object({
    agentId: z.string(),
    name: z.string(),
    outcome: knowledgeLinkOutcomeSchema.nullable(),
    firstPublication: z.boolean(),
    problem: z.object({ code: z.string(), message: z.string() }).nullable(),
    impact: agentPublishImpactSchema.nullable(),
  })),
})
export type KnowledgeLinksPreview = z.infer<typeof knowledgeLinksPreviewSchema>

export const knowledgeLinksResultSchema = z.object({
  mode: knowledgeLinkModeSchema,
  results: z.array(z.object({ agentId: z.string(), name: z.string(), outcome: knowledgeLinkOutcomeSchema, versionNumber: z.number().nullable() })),
})
export type KnowledgeLinksResult = z.infer<typeof knowledgeLinksResultSchema>

export const KNOWLEDGE_LINK_OUTCOME_LABELS: Record<KnowledgeLinkOutcome, string> = {
  UNCHANGED: "Sem mudança",
  DRAFT_SAVED: "Salvo no rascunho",
  PUBLISHED: "Publicado",
  DRAFT_ONLY_OTHER_CHANGES: "Só no rascunho (há outras alterações pendentes)",
}

/** Escolha da pessoa num agente que ela tocou (de qualquer página): o agente como ela o viu e se a base deve ficar ligada. */
export type KnowledgeLinkChoice = { candidate: KnowledgeLinkCandidate; linked: boolean }

/** Marca ou desmarca: voltar ao que o rascunho já tem desfaz a escolha (nada a gravar nesse agente). */
export function toggleKnowledgeLinkChoice(choices: ReadonlyMap<string, KnowledgeLinkChoice>, candidate: KnowledgeLinkCandidate, linked: boolean): Map<string, KnowledgeLinkChoice> {
  const next = new Map(choices)
  if (linked === candidate.linkedInDraft) next.delete(candidate.id)
  else next.set(candidate.id, { candidate, linked })
  return next
}

/**
 * Mudanças a enviar. No rascunho: só as escolhas da pessoa. Ao publicar: também os publicados em que a base já está só no rascunho ou
 * só no que a IA usa (`pendingPublish`, vindos do servidor). Agente nunca publicado que a pessoa não tocou nunca entra — publicar daqui
 * nunca publica um agente por tabela.
 */
export function knowledgeLinkChangesOf(choices: ReadonlyMap<string, KnowledgeLinkChoice>, pendingPublish: readonly KnowledgeLinkCandidate[], mode: KnowledgeLinkMode): KnowledgeLinkChange[] {
  const changes = [...choices.values()].map(({ candidate, linked }) => ({ agentId: candidate.id, linked, expectedDraftRevision: candidate.draft.revision }))
  if (mode === "DRAFT") return changes
  const touched = new Set(changes.map((change) => change.agentId))
  const pending = pendingPublish.filter((candidate) => !touched.has(candidate.id) && candidate.published).map((candidate) => ({ agentId: candidate.id, linked: candidate.linkedInDraft, expectedDraftRevision: candidate.draft.revision }))
  return [...changes, ...pending]
}
