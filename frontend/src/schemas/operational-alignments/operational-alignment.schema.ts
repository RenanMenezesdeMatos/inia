import { scopeValueIssue } from "@/lib/scope-links/scope-links"
import { z } from "zod"

import { operatingUniverseSchema } from "@/schemas/operating-universe/operating-universe.schema"

/** Alinhamento operacional (`/api/v1/admin/operational-alignments`): orientação temporária que se sobrepõe ao trecho de um procedimento. */
export const alignmentStateSchema = z.enum(["DRAFT", "SCHEDULED", "IN_FORCE", "ENDED", "CANCELLED"])
export type AlignmentState = z.infer<typeof alignmentStateSchema>
export const alignmentScopeTypeSchema = z.enum(["UNIVERSE", "GROUPS"])
/** Vínculo do público (223): Grupo inteiro (`subteamId` nulo) ou um Subgrupo daquele Grupo. */
export const alignmentLinkSchema = z.object({ teamId: z.string(), teamName: z.string().nullable().catch(null), subteamId: z.string().nullable().catch(null), subteamName: z.string().nullable().catch(null) })
export type AlignmentLink = z.infer<typeof alignmentLinkSchema>
export type AlignmentScopeType = z.infer<typeof alignmentScopeTypeSchema>
export const alignmentRelationSchema = z.enum(["SAME_TOPIC", "INDEPENDENT"])
export type AlignmentRelation = z.infer<typeof alignmentRelationSchema>

const named = z.object({ id: z.string(), name: z.string() })

export const alignmentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  reference: z.string(),
  status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED", "CANCELLED"]),
  title: z.string(),
  guidance: z.string(),
  processes: z.array(z.object({ id: z.string(), title: z.string(), documentType: z.string().nullable(), operatingUniverse: operatingUniverseSchema.nullable().optional() })),
  affectedTopic: z.string().nullable(),
  reason: named.nullable(),
  requestReasons: z.array(named),
  justification: z.string(),
  operatingUniverse: operatingUniverseSchema,
  scopeType: alignmentScopeTypeSchema,
  links: z.array(alignmentLinkSchema).catch([]),
  product: named.nullable(),
  startsOn: z.string(),
  endsOn: z.string(),
  timeZone: z.string(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string(),
  contentHash: z.string(),
  changeReason: z.string().nullable(),
  createdBy: z.string().nullable(),
  /** Quem DEFINIU a orientação (221; cargo copiado na publicação). Null nas versões anteriores (vale quem publicou). */
  responsible: z.object({ id: z.string(), name: z.string(), jobTitle: z.string().nullable() }).nullable().optional(),
  createdAt: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
  publishedBy: z.string().nullable(),
  publishedAt: z.string().nullable(),
  supersededAt: z.string().nullable(),
  endedBy: z.string().nullable(),
  endedAt: z.string().nullable(),
  endReason: z.string().nullable(),
  relations: z.array(z.object({ otherAlignmentId: z.string(), otherReference: z.string(), otherTitle: z.string().nullable().optional(), relation: alignmentRelationSchema, decidedBy: z.string().nullable(), decidedAt: z.string() })).optional(),
})
export type AlignmentVersion = z.infer<typeof alignmentVersionSchema>

export const alignmentSummarySchema = z.object({
  id: z.string(),
  state: alignmentStateSchema,
  hasDraft: z.boolean(),
  current: alignmentVersionSchema.nullable(),
  draft: alignmentVersionSchema.nullable(),
  shown: alignmentVersionSchema,
})
export type AlignmentSummary = z.infer<typeof alignmentSummarySchema>

/** Linha da lista (paginada no servidor): a versão mostrada, a situação e um resumo dos processos. */
export const alignmentListItemSchema = z.object({
  id: z.string(),
  reference: z.string(),
  version: z.number(),
  title: z.string(),
  reasonName: z.string().nullable(),
  state: alignmentStateSchema,
  hasDraft: z.boolean(),
  operatingUniverse: operatingUniverseSchema,
  scopeType: alignmentScopeTypeSchema,
  links: z.array(alignmentLinkSchema).catch([]),
  productName: z.string().nullable(),
  startsOn: z.string(),
  endsOn: z.string(),
  affectedTopic: z.string().nullable(),
  processCount: z.number(),
  processTitles: z.array(z.string()),
  updatedAt: z.string(),
})
export type AlignmentListItem = z.infer<typeof alignmentListItemSchema>

/** Processo (base de procedimento publicada) oferecido no seletor. */
export const processOptionSchema = z.object({ id: z.string(), title: z.string(), documentType: z.string(), operatingUniverse: operatingUniverseSchema.nullable(), publishedAt: z.string().nullable() })
export type ProcessOption = z.infer<typeof processOptionSchema>

export const PROCESS_TYPE_LABELS: Record<string, string> = { PROCEDURE: "PR — Procedimento", WORK_INSTRUCTION: "IT — Instrução de trabalho", FLOW: "Fluxo", RULE: "Regra", MANUAL: "Manual", FAQ: "FAQ" }

export const alignmentDetailSchema = alignmentSummarySchema.extend({ versions: z.array(alignmentVersionSchema) })
export type AlignmentDetail = z.infer<typeof alignmentDetailSchema>

/** Grupos/Subgrupos administrados, com o universo de cada um — o encadeamento universo → Grupo → Subgrupo vem daqui. */
export const alignmentScopeOptionsSchema = z.object({
  universe: z.boolean(),
  teams: z.array(z.object({ id: z.string(), name: z.string(), operatingUniverse: operatingUniverseSchema.nullable(), manageable: z.boolean(), subteams: z.array(z.object({ id: z.string(), name: z.string(), operatingUniverse: operatingUniverseSchema.nullable() })) })),
})
export type AlignmentScopeOptions = z.infer<typeof alignmentScopeOptionsSchema>

export const alignmentOverlapSchema = z.object({ alignmentId: z.string(), version: alignmentVersionSchema, sharedProcesses: z.array(z.object({ id: z.string(), title: z.string() })).default([]), sameScopeLevel: z.boolean(), moreSpecific: z.enum(["THIS", "OTHER", "MIXED"]).nullable().catch(null) })
export type AlignmentOverlap = z.infer<typeof alignmentOverlapSchema>
export const alignmentPublicationPreviewSchema = z.object({ draft: alignmentVersionSchema, overlaps: z.array(alignmentOverlapSchema) })
export type AlignmentPublicationPreview = z.infer<typeof alignmentPublicationPreviewSchema>

export const affectedAssessmentsSchema = z.object({
  alignmentId: z.string(),
  truncated: z.boolean(),
  items: z.array(z.object({ callAssessmentId: z.string(), interactionId: z.string(), personId: z.string(), personName: z.string(), occurredAt: z.string(), version: z.number(), deviations: z.number(), criteria: z.number(), withDeviation: z.boolean() }).passthrough()),
})
export type AffectedAssessments = z.infer<typeof affectedAssessmentsSchema>

/** Formulário (o backend valida tudo de novo: escopo, universo, vínculos, vigência). */
export const alignmentFormSchema = z
  .object({
    title: z.string().trim().min(3, "Mínimo de 3 caracteres.").max(160),
    guidance: z.string().trim().min(10, "Descreva a orientação que passa a valer (mínimo de 10 caracteres).").max(8000),
    affectedDocumentIds: z.array(z.string()).min(1, "Inclua ao menos um processo."),
    // Opcional: o alinhamento é sempre de um processo, mas pode ser orientação nova, sem trecho da base que mude.
    affectedTopic: z.string().trim().max(500).refine((value) => value === "" || value.length >= 3, "Mínimo de 3 caracteres (ou deixe vazio)."),
    reasonId: z.string().min(1, "Escolha o motivo do alinhamento."),
    requestSubjectIds: z.array(z.string()).max(30),
    justification: z.string().trim().min(10, "A justificativa é obrigatória: explique o motivo do alinhamento (mínimo de 10 caracteres).").max(4000),
    operatingUniverse: operatingUniverseSchema.nullable().refine((value) => value !== null, "Escolha o universo."),
    /** Público (223): o universo inteiro (`global`) ou os Grupos escolhidos, cada um inteiro ou só alguns Subgrupos. */
    scope: z.object({ global: z.boolean(), groups: z.array(z.object({ teamId: z.string(), subteamIds: z.array(z.string()), mode: z.enum(["WHOLE", "SUBTEAMS"]) })) }),
    productId: z.string().nullable(),
    startsOn: z.string().min(1, "Escolha o início."),
    endsOn: z.string().min(1, "Escolha o término."),
    changeReason: z.string().trim().max(1000).nullable(),
    /** Responsável pela decisão (null = quem está cadastrando). */
    responsiblePersonId: z.string().nullable(),
  })
  .superRefine((value, context) => {
    if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) context.addIssue({ code: "custom", path: ["endsOn"], message: "O término não pode ser antes do início." })
    const scopeIssue = scopeValueIssue(value.scope)
    if (scopeIssue) context.addIssue({ code: "custom", path: ["scope"], message: scopeIssue })
  })
// Estado do formulário (entrada: universo ainda pode estar vazio); o envio só acontece depois de validado.
export type AlignmentFormValues = z.input<typeof alignmentFormSchema>

export const ALIGNMENT_STATE_LABELS: Record<AlignmentState, string> = { DRAFT: "Rascunho", SCHEDULED: "Agendado", IN_FORCE: "Vigente", ENDED: "Encerrado", CANCELLED: "Cancelado" }
export const ALIGNMENT_VERSION_STATUS_LABELS: Record<AlignmentVersion["status"], string> = { DRAFT: "Rascunho", PUBLISHED: "Publicada", SUPERSEDED: "Substituída", CANCELLED: "Cancelada" }

/** Motivo do alinhamento (catálogo da organização) e motivo do pedido do cliente (assuntos canônicos das chamadas). */
export const alignmentReasonSchema = z.object({ id: z.string(), name: z.string(), active: z.boolean(), position: z.number(), uses: z.number() })
export type AlignmentReason = z.infer<typeof alignmentReasonSchema>
export const requestReasonSchema = z.object({ id: z.string(), code: z.string(), name: z.string() })
export type RequestReason = z.infer<typeof requestReasonSchema>

/** Responsável pela orientação: lideranças ativas da organização (e quem está cadastrando), buscadas no servidor pelo nome. */
export const responsibleOptionSchema = z.object({ id: z.string(), name: z.string(), jobTitle: z.string().nullable() })
export type ResponsibleOption = z.infer<typeof responsibleOptionSchema>

