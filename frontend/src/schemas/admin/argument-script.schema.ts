import { z } from "zod"

/**
 * Argumentário (`/api/v1/admin/argument-scripts`) — evolução das antigas "Regras de chamada". Cada campo guarda o SIGNIFICADO
 * do que o administrador quer dizer (situação, exceção, o que deve/pode ser feito, o que precisa ser dito, o que evitar), para
 * que a avaliação respeite a natureza de cada um. Publicar um argumentário é administração de conteúdo — nunca aprovação de
 * feedback. As chaves (`key`) dos itens são do servidor: a tela as devolve sem exibi-las.
 */
export const guidanceModalitySchema = z.enum(["MUST", "MAY", "UNSPECIFIED"])
export type GuidanceModality = z.infer<typeof guidanceModalitySchema>

export const pointGroupModeSchema = z.enum(["ALL", "ANY"])
export type PointGroupMode = z.infer<typeof pointGroupModeSchema>

export const argumentScriptStatusSchema = z.enum(["ACTIVE", "ARCHIVED"])
export type ArgumentScriptStatus = z.infer<typeof argumentScriptStatusSchema>

export const argumentScriptConversionSchema = z.enum(["NATIVE", "LEGACY_UNSTRUCTURED"])
export type ArgumentScriptConversion = z.infer<typeof argumentScriptConversionSchema>

export const argumentScriptScopeTypeSchema = z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"])
export type ArgumentScriptScopeType = z.infer<typeof argumentScriptScopeTypeSchema>

const nullableText = z.string().nullable().catch(null)

export const argumentScriptContentSchema = z.object({
  schemaVersion: z.literal(1).catch(1),
  trigger: nullableText,
  notApplicableWhen: nullableText,
  operatorGuidance: z.array(z.object({ key: z.string(), text: z.string(), modality: guidanceModalitySchema.catch("UNSPECIFIED") })).catch([]),
  requiredPoints: z
    .array(
      z.object({
        key: z.string(),
        mode: pointGroupModeSchema,
        items: z.array(z.object({ key: z.string(), text: z.string(), condition: nullableText })),
      }),
    )
    .catch([]),
  avoid: z.array(z.object({ key: z.string(), text: z.string() })).catch([]),
  suggestedScript: nullableText,
  monitoringReference: nullableText,
  /** Texto da antiga "Regra de chamada" (somente leitura). */
  legacyExpectation: z.string().nullish(),
})
export type ArgumentScriptContent = z.infer<typeof argumentScriptContentSchema>

/** O que a tela envia: mesma forma; item novo vai sem `key` (o servidor gera), item existente devolve a sua. */
export type ArgumentScriptContentInput = {
  schemaVersion: 1
  trigger: string | null
  notApplicableWhen: string | null
  operatorGuidance: { key?: string; text: string; modality: GuidanceModality }[]
  requiredPoints: { key?: string; mode: PointGroupMode; items: { key?: string; text: string; condition: string | null }[] }[]
  avoid: { key?: string; text: string }[]
  suggestedScript: string | null
  monitoringReference: string | null
  legacyExpectation?: string | null
}

export const argumentScriptIssueSchema = z.object({ field: z.string(), code: z.string(), message: z.string() })
export type ArgumentScriptIssue = z.infer<typeof argumentScriptIssueSchema>

export const argumentScriptVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]),
  content: argumentScriptContentSchema,
  contentHash: z.string().catch(""),
  sourceDocumentId: nullableText,
  sourceDocumentTitle: nullableText,
  sourceReference: nullableText,
  effectiveFrom: nullableText,
  effectiveUntil: nullableText,
  publishedAt: nullableText,
  publishedByName: nullableText,
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string().catch(""),
})
export type ArgumentScriptVersion = z.infer<typeof argumentScriptVersionSchema>

export const argumentScriptSchema = z.object({
  id: z.string(),
  name: z.string(),
  businessDomainId: nullableText,
  businessDomainName: nullableText,
  scopeType: argumentScriptScopeTypeSchema,
  teamId: nullableText,
  teamName: nullableText,
  subteamId: nullableText,
  subteamName: nullableText,
  subjectName: nullableText,
  status: argumentScriptStatusSchema,
  conversion: argumentScriptConversionSchema,
  currentVersion: z.number().nullable().catch(null),
  currentEffectiveFrom: nullableText,
  currentEffectiveUntil: nullableText,
  draftVersion: z.number().nullable().catch(null),
  updatedAt: z.coerce.string(),
  createdAt: z.coerce.string(),
  canEdit: z.boolean().catch(false),
})
export type ArgumentScript = z.infer<typeof argumentScriptSchema>

export const argumentScriptDetailSchema = argumentScriptSchema.extend({
  current: argumentScriptVersionSchema.nullable().catch(null),
  draft: argumentScriptVersionSchema.nullable().catch(null),
  history: z.array(argumentScriptVersionSchema).catch([]),
  draftIssues: z.array(argumentScriptIssueSchema).catch([]),
  everPublished: z.boolean().catch(false),
})
export type ArgumentScriptDetail = z.infer<typeof argumentScriptDetailSchema>

export const argumentScriptScopeOptionsSchema = z.object({
  allTeams: z.boolean(),
  teamIds: z.array(z.string()).catch([]),
  subteamIds: z.array(z.string()).catch([]),
})
export type ArgumentScriptScopeOptions = z.infer<typeof argumentScriptScopeOptionsSchema>

export const GUIDANCE_MODALITY_LABELS: Record<GuidanceModality, string> = {
  MUST: "Deve",
  MAY: "Pode",
  UNSPECIFIED: "Sem classificação (cadastro antigo)",
}

export const POINT_GROUP_MODE_LABELS: Record<PointGroupMode, string> = {
  ALL: "Todos obrigatórios",
  ANY: "Alternativas — basta uma",
}

export const ARGUMENT_SCRIPT_STATUS_LABELS: Record<ArgumentScriptStatus, string> = {
  ACTIVE: "Ativo",
  ARCHIVED: "Encerrado",
}

export const LEGACY_CONVERSION_LABEL = "Convertido do cadastro antigo — revise os campos"
export const READ_ONLY_LABEL = "Somente leitura — vale para o seu escopo, administrado acima"
