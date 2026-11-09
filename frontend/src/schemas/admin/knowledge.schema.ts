import { z } from "zod"

export const knowledgeDocumentTypeSchema = z.enum(["PROCEDURE", "MANUAL", "FAQ", "RULE", "FLOW"])
export type KnowledgeDocumentType = z.infer<typeof knowledgeDocumentTypeSchema>

export const knowledgeSourceTypeSchema = z.enum(["TEXT", "PDF", "DOCX", "TXT", "JSON"])
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>

/**
 * Status de uma base (PEN-008): o da versão EM USO; sem versão decidida, o da mais recente. Rascunho, publicação pedida e falha nunca
 * contam como em uso: quem diz o que a IA consulta é `inUseVersion` (lista) e `inUse` (detalhe).
 */
export const knowledgeStatusSchema = z.enum(["DRAFT", "APPROVED", "PROCESSING", "FAILED", "PUBLISHED", "ARCHIVED"])
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>

export const knowledgeUpdateStatusSchema = z.enum(["PROCESSING", "FAILED"])
export type KnowledgeUpdateStatus = z.infer<typeof knowledgeUpdateStatusSchema>

const orgScopeSchema = z.object({
  id: z.string(),
  scopeType: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
})

const subjectScopeSchema = z.object({
  id: z.string(),
  scopeType: z.string(),
  subjectId: z.string().nullable(),
  subjectName: z.string().nullable(),
})

export const knowledgeDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  documentType: knowledgeDocumentTypeSchema,
  sourceType: knowledgeSourceTypeSchema,
  originalFilename: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string().nullable(),
  authorName: z.string().nullable(),
  status: z.string(),
  inUseVersion: z.number().nullable(),
  draftVersion: z.number().nullable(),
  updateVersion: z.number().nullable(),
  updateStatus: knowledgeUpdateStatusSchema.nullable(),
  excerpt: z.string().nullable(),
  orgScopes: z.array(orgScopeSchema),
  subjectScopes: z.array(subjectScopeSchema),
})
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>

/** Configuração guardada na versão. Nula = versão anterior a esse registro: a configuração da época não foi guardada. */
export const knowledgeVersionConfigSchema = z.object({
  title: z.string(),
  documentType: knowledgeDocumentTypeSchema,
  sourceType: knowledgeSourceTypeSchema,
  file: z.object({ id: z.string(), filename: z.string().nullable(), mimeType: z.string().nullable(), sizeBytes: z.number().nullable(), checksum: z.string() }).nullable(),
  orgScopes: z.array(z.object({ scopeType: z.string(), teamId: z.string().nullable().optional(), subteamId: z.string().nullable().optional() })),
  subjectScopes: z.array(z.object({ scopeType: z.string(), subjectId: z.string().nullable().optional() })),
  productNodeIds: z.array(z.string()),
})
export type KnowledgeVersionConfig = z.infer<typeof knowledgeVersionConfigSchema>

/** Registro da conversão do PDF em Markdown. Nulo = versão anterior à conversão, base digitada ou outro formato de arquivo. */
export const pdfPageStatusSchema = z.enum(["TEXT", "PARTIAL", "NO_TEXT", "BLANK", "UNREADABLE"])
export type PdfPageStatus = z.infer<typeof pdfPageStatusSchema>
export const pdfExtractionSchema = z.object({
  version: z.string(),
  pageCount: z.number(),
  pages: z.array(z.object({ page: z.number(), status: pdfPageStatusSchema, chars: z.number(), headings: z.number(), tables: z.number(), offset: z.number().nullable() })),
  headings: z.number(),
  tables: z.number(),
  repeatedLinesRemoved: z.number(),
  taggedPages: z.number(),
  edited: z.boolean(),
  /** As imagens do arquivo e onde cada uma entra no texto. Ausente = as imagens não foram lidas, o que não quer dizer que o PDF não tem nenhuma. */
  images: z.array(z.object({ id: z.string(), page: z.number(), offset: z.number().nullable(), width: z.number(), height: z.number() })).optional(),
  imagesOmitted: z.number().optional(),
  /** Páginas digitalizadas lidas pelo OCR: o texto delas veio da imagem da página e pode ter erros de leitura. Ausente = nenhuma. */
  ocr: z
    .object({ version: z.string(), engine: z.string(), printRule: z.string(), pages: z.array(z.number()), failedPages: z.array(z.number()), skippedPages: z.array(z.number()), prints: z.number() })
    .optional()
    .catch(undefined),
})
export type PdfExtraction = z.infer<typeof pdfExtractionSchema>

/** A leitura das páginas digitalizadas do rascunho, em segundo plano. Em READING as contagens são páginas lidas; em PRINTS, páginas com print já separadas. */
export const knowledgeOcrStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"]),
  stage: z.enum(["READING", "PRINTS"]).nullable(),
  pagesDone: z.number(),
  pagesTotal: z.number(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.coerce.string(),
  finishedAt: z.coerce.string().nullable(),
})
export type KnowledgeOcrStatus = z.infer<typeof knowledgeOcrStatusSchema>
export const isOcrReading = (ocr: KnowledgeOcrStatus | null | undefined) => ocr?.status === "QUEUED" || ocr?.status === "RUNNING"

/** O que a IA recebe de uma versão: os mesmos trechos da busca, com seção e página. */
export const knowledgeAiPreviewSchema = z.object({
  versionId: z.string(),
  version: z.number(),
  extraction: pdfExtractionSchema.nullable(),
  chunks: z.array(z.object({ index: z.number(), heading: z.string(), pages: z.object({ from: z.number(), to: z.number() }).nullable(), chars: z.number(), text: z.string(), /** O mesmo texto com as quebras de linha do documento, só para a leitura na tela. Null = já está igual. */ displayText: z.string().nullish(), /** Imagens do arquivo neste trecho, para a tela: a IA não as recebe. `at` = posição no texto do trecho. */ images: z.array(z.object({ id: z.string(), page: z.number(), width: z.number(), height: z.number(), at: z.number() })).nullish() })),
})
export type KnowledgeAiPreview = z.infer<typeof knowledgeAiPreviewSchema>

/**
 * Versão cujo alcance quem lê não alcança (rascunho, última ou editável): a API manda só número e situação, sem texto, extração nem
 * configuração, e recusa mexer nela com 403 KNOWLEDGE_SCOPE_FORBIDDEN. Resposta anterior a essa regra não traz o campo: vale false.
 */
const versionRestrictedSchema = z.boolean().default(false)

export const knowledgeDocumentDetailSchema = knowledgeDocumentSchema.extend({
  /** Os produtos que valem agora; os do rascunho estão em `draft.config` e só valem quando a versão entrar em uso. */
  inUseProductNodeIds: z.array(z.string()).catch([]),
  latestVersion: z.object({ version: z.number(), content: z.string(), status: z.string(), createdAt: z.coerce.string(), restricted: versionRestrictedSchema }).nullable(),
  inUse: z
    .object({
      id: z.string(),
      version: z.number(),
      status: z.string(),
      content: z.string(),
      extraction: pdfExtractionSchema.nullish().catch(null),
      publishedAt: z.coerce.string().nullable(),
      publishedByName: z.string().nullable(),
      changeSummary: z.string().nullable(),
    })
    .nullable(),
  archived: z.object({ id: z.string(), version: z.number() }).nullable(),
  draft: z
    .object({
      id: z.string(),
      version: z.number(),
      status: z.string(),
      content: z.string(),
      extraction: pdfExtractionSchema.nullish().catch(null),
      config: knowledgeVersionConfigSchema.nullable(),
      textAvailable: z.boolean(),
      changeSummary: z.string().nullable(),
      updatedAt: z.coerce.string().nullable(),
      updatedByName: z.string().nullable(),
      ocr: knowledgeOcrStatusSchema.nullish().catch(null),
      restricted: versionRestrictedSchema,
    })
    .nullable(),
  updates: z.array(
    z.object({
      id: z.string(),
      version: z.number(),
      status: knowledgeUpdateStatusSchema,
      requestedAt: z.coerce.string().nullable(),
      requestedByName: z.string().nullable(),
      errorCode: z.string().nullable(),
      errorMessage: z.string().nullable(),
      /** Base arquivada: quem confirmou que ela volta a valer quando esta versão ficar pronta. */
      reactivationConfirmedByName: z.string().nullish(),
    }),
  ),
  editable: z
    .object({
      versionId: z.string(),
      version: z.number(),
      status: z.string(),
      content: z.string(),
      extraction: pdfExtractionSchema.nullish().catch(null),
      config: knowledgeVersionConfigSchema.nullable(),
      textAvailable: z.boolean(),
      restricted: versionRestrictedSchema,
    })
    .nullable(),
})
export type KnowledgeDocumentDetail = z.infer<typeof knowledgeDocumentDetailSchema>
export type KnowledgeDocumentUpdate = KnowledgeDocumentDetail["updates"][number]

/** Há rascunho, mas o alcance dele está fora do de quem lê: nem o texto nem as ações sobre ele (editar, trocar arquivo, reprocessar, publicar, descartar). */
export function hasRestrictedDraft(detail: Pick<KnowledgeDocumentDetail, "draft">): boolean {
  return detail.draft?.restricted === true
}

export function isKnowledgeProcessing(detail: Pick<KnowledgeDocumentDetail, "updates">): boolean {
  return detail.updates.some((update) => update.status === "PROCESSING")
}

/** Algo em andamento que muda a tela sozinho: publicação em processamento ou leitura das páginas digitalizadas do rascunho. */
export function isKnowledgeBusy(detail: Pick<KnowledgeDocumentDetail, "updates" | "draft">): boolean {
  return isKnowledgeProcessing(detail) || isOcrReading(detail.draft?.ocr)
}

export const knowledgeDocumentPreviewSchema = z.object({ format: z.literal("html"), html: z.string() })
export type KnowledgeDocumentPreview = z.infer<typeof knowledgeDocumentPreviewSchema>

export const knowledgeVersionSituationSchema = z.enum(["IN_USE", "ARCHIVED", "REPLACED", "DRAFT", "OLD_DRAFT", "PROCESSING", "FAILED", "SUPERSEDED"])
export type KnowledgeVersionSituation = z.infer<typeof knowledgeVersionSituationSchema>

const versionRowBase = {
  id: z.string(),
  number: z.number(),
  status: z.string(),
  situation: knowledgeVersionSituationSchema,
  createdAt: z.coerce.string(),
  publishedAt: z.coerce.string().nullable(),
}

export const knowledgeVersionRowSchema = z.discriminatedUnion("restricted", [
  z.object({ ...versionRowBase, restricted: z.literal(true) }),
  z.object({
    ...versionRowBase,
    restricted: z.literal(false),
    origin: z.string(),
    authorName: z.string().nullable(),
    updatedAt: z.coerce.string().nullable(),
    updatedByName: z.string().nullable(),
    publishRequestedAt: z.coerce.string().nullable(),
    publishRequestedByName: z.string().nullable(),
    publishedByName: z.string().nullable(),
    changeSummary: z.string().nullable(),
    revertedFromNumber: z.number().nullable(),
    reactivationConfirmedAt: z.coerce.string().nullish(),
    reactivationConfirmedByName: z.string().nullish(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    supersededReason: z.enum(["NEWER_VERSION", "ARCHIVED"]).nullable(),
    textAvailable: z.boolean(),
    hasConfig: z.boolean(),
    usageCount: z.number(),
    lastUsedAt: z.coerce.string().nullable(),
  }),
])
export type KnowledgeVersionRow = z.infer<typeof knowledgeVersionRowSchema>
export type KnowledgeVersionFullRow = Extract<KnowledgeVersionRow, { restricted: false }>

export const knowledgeVersionDetailSchema = z.object({
  id: z.string(),
  number: z.number(),
  status: z.string(),
  content: z.string(),
  textAvailable: z.boolean(),
  config: knowledgeVersionConfigSchema.nullable(),
  fileId: z.string().nullable(),
  changeSummary: z.string().nullable(),
  publishedAt: z.coerce.string().nullable(),
})
export type KnowledgeVersionDetail = z.infer<typeof knowledgeVersionDetailSchema>

const comparisonVersionSchema = z.object({ id: z.string(), number: z.number(), status: z.string() })
const comparisonFileSideSchema = z.object({ filename: z.string().nullable(), sizeBytes: z.number().nullable() }).nullable()

export const knowledgeTextDiffRowSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNCHANGED"), leftLine: z.number(), rightLine: z.number(), left: z.string(), right: z.string() }),
  z.object({ kind: z.literal("CHANGED"), leftLine: z.number(), rightLine: z.number(), left: z.string(), right: z.string() }),
  z.object({ kind: z.literal("ADDED"), rightLine: z.number(), right: z.string() }),
  z.object({ kind: z.literal("REMOVED"), leftLine: z.number(), left: z.string() }),
])
export type KnowledgeTextDiffRow = z.infer<typeof knowledgeTextDiffRowSchema>

export const knowledgeVersionComparisonSchema = z.object({
  from: comparisonVersionSchema,
  to: comparisonVersionSchema,
  configuration: z.discriminatedUnion("comparable", [
    z.object({
      comparable: z.literal(true),
      changes: z.array(z.object({ field: z.string(), label: z.string(), kind: z.enum(["ADDED", "REMOVED", "CHANGED"]), from: z.array(z.string()), to: z.array(z.string()) })),
    }),
    z.object({ comparable: z.literal(false), reason: z.literal("NOT_RECORDED"), versions: z.array(z.number()) }),
  ]),
  file: z.object({
    change: z.enum(["NONE", "ADDED", "REMOVED", "REPLACED", "UNCHANGED"]),
    from: comparisonFileSideSchema,
    to: comparisonFileSideSchema,
  }),
  content: z.discriminatedUnion("comparable", [
    z.object({
      comparable: z.literal(true),
      identical: z.boolean(),
      added: z.number(),
      removed: z.number(),
      changed: z.number(),
      unchanged: z.number(),
      rows: z.array(knowledgeTextDiffRowSchema),
    }),
    z.object({ comparable: z.literal(false), reason: z.enum(["TEXT_UNAVAILABLE", "TOO_LARGE"]), versions: z.array(z.number()) }),
  ]),
  /** Mesmo arquivo, conversão diferente: quantas palavras de fato mudaram, já que as linhas mudam de forma. */
  reconversion: z
    .object({ from: z.string().nullable(), to: z.string().nullable(), words: z.number(), onlyInFrom: z.number(), onlyInTo: z.number(), examplesFrom: z.array(z.string()), examplesTo: z.array(z.string()) })
    .nullish()
    .catch(null),
})
export type KnowledgeVersionComparison = z.infer<typeof knowledgeVersionComparisonSchema>
export type KnowledgeConfigurationComparison = KnowledgeVersionComparison["configuration"]
export type KnowledgeConfigChange = Extract<KnowledgeConfigurationComparison, { comparable: true }>["changes"][number]
export type KnowledgeFileComparison = KnowledgeVersionComparison["file"]
export type KnowledgeContentComparison = KnowledgeVersionComparison["content"]
export type KnowledgeReconversion = NonNullable<KnowledgeVersionComparison["reconversion"]>

export const DOCUMENT_TYPE_LABELS: Record<KnowledgeDocumentType, string> = {
  PROCEDURE: "Procedimento",
  MANUAL: "Manual",
  FAQ: "FAQ",
  RULE: "Regra",
  FLOW: "Fluxo",
}

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  DRAFT: "Rascunho",
  APPROVED: "Aprovada",
  PROCESSING: "Processando",
  FAILED: "Falha",
  PUBLISHED: "Publicada",
  ARCHIVED: "Arquivada",
}

/** Filtro da lista. "Aprovada" é só uma marca do rascunho (PEN-009): entra junto de Rascunho na consulta, sem opção própria. */
export const KNOWLEDGE_STATUS_FILTER_LABELS = {
  PUBLISHED: KNOWLEDGE_STATUS_LABELS.PUBLISHED,
  DRAFT: KNOWLEDGE_STATUS_LABELS.DRAFT,
  PROCESSING: KNOWLEDGE_STATUS_LABELS.PROCESSING,
  FAILED: KNOWLEDGE_STATUS_LABELS.FAILED,
  ARCHIVED: KNOWLEDGE_STATUS_LABELS.ARCHIVED,
} satisfies Partial<Record<KnowledgeStatus, string>>

export const KNOWLEDGE_UPDATE_STATUS_LABELS: Record<KnowledgeUpdateStatus, string> = {
  PROCESSING: KNOWLEDGE_STATUS_LABELS.PROCESSING,
  FAILED: KNOWLEDGE_STATUS_LABELS.FAILED,
}

export const KNOWLEDGE_SITUATION_LABELS: Record<KnowledgeVersionSituation, string> = {
  IN_USE: "Em uso pela IA",
  ARCHIVED: "Arquivada",
  REPLACED: "Publicada · substituída",
  DRAFT: "Rascunho",
  OLD_DRAFT: "Rascunho não publicado",
  PROCESSING: "Processando",
  FAILED: "Falha",
  SUPERSEDED: "Não entrou em uso",
}

export const KNOWLEDGE_SUPERSEDED_REASON_LABELS: Record<NonNullable<KnowledgeVersionFullRow["supersededReason"]>, string> = {
  NEWER_VERSION: "uma versão mais nova ficou pronta antes",
  ARCHIVED: "a base foi arquivada durante o processamento",
}

export function knowledgeStatusLabel(status: string): string {
  return status in KNOWLEDGE_STATUS_LABELS ? KNOWLEDGE_STATUS_LABELS[status as KnowledgeStatus] : status
}

// Como o conteúdo chegou: "TEXT" é o texto colado no cadastro; os demais são upload de arquivo.
export const SOURCE_TYPE_LABELS: Record<KnowledgeSourceType, string> = {
  TEXT: "Texto",
  PDF: "PDF",
  DOCX: "Word",
  TXT: "TXT",
  JSON: "JSON",
}

export function isFileSource(sourceType: KnowledgeSourceType) {
  return sourceType !== "TEXT"
}
