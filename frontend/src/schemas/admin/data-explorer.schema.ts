import { z } from "zod"

/** Consulta de dados da Central. O servidor valida tudo de novo: estes esquemas só descrevem o que a tela recebe e envia. */
export const EXPLORER_OPERATORS = ["EQ", "NEQ", "IN", "GT", "GTE", "LT", "LTE", "BETWEEN", "IS_EMPTY", "IS_NOT_EMPTY"] as const
export const explorerOperatorSchema = z.enum(EXPLORER_OPERATORS)
export type ExplorerOperator = z.infer<typeof explorerOperatorSchema>

export const explorerColumnTypeSchema = z.enum(["TEXT", "ENUM", "NUMBER", "DATE", "DATETIME", "TIME", "MONTH", "BOOLEAN", "UUID"])
export type ExplorerColumnType = z.infer<typeof explorerColumnTypeSchema>

export const explorerLimitsSchema = z.object({
  defaultPageSize: z.number(),
  maxPageSize: z.number(),
  maxSelectedColumns: z.number(),
  maxFilterConditions: z.number(),
  maxFilterDepth: z.number(),
  maxListValues: z.number(),
  minSearchLength: z.number(),
  maxSearchLength: z.number(),
  queryTimeoutSeconds: z.number(),
  countCap: z.number(),
  exportMaxRows: z.number(),
  exportMaxBytes: z.number(),
  cancelMaxRows: z.number(),
  cancelMaxKeys: z.number(),
})
export type ExplorerLimits = z.infer<typeof explorerLimitsSchema>

export const explorerDatasetSummarySchema = z.object({ code: z.string(), label: z.string(), description: z.string(), origin: z.enum(["IMPORTED", "GENERATED"]) })
export type ExplorerDatasetSummary = z.infer<typeof explorerDatasetSummarySchema>

export const deletedItemTypeSchema = z.object({ type: z.string(), label: z.string() })
export type DeletedItemType = z.infer<typeof deletedItemTypeSchema>

export const explorerCatalogSchema = z.object({ datasets: z.array(explorerDatasetSummarySchema), deletedItemTypes: z.array(deletedItemTypeSchema), limits: explorerLimitsSchema })
export type ExplorerCatalog = z.infer<typeof explorerCatalogSchema>

export const explorerColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  type: explorerColumnTypeSchema,
  nullable: z.boolean(),
  personal: z.boolean(),
  filterable: z.boolean(),
  sortable: z.boolean(),
  searchable: z.boolean(),
  operators: z.array(explorerOperatorSchema),
  options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
  defaultVisible: z.boolean(),
})
export type ExplorerColumn = z.infer<typeof explorerColumnSchema>

const sortSchema = z.object({ column: z.string(), direction: z.enum(["ASC", "DESC"]) })
export type ExplorerSort = z.infer<typeof sortSchema>

export const explorerDatasetSchema = explorerDatasetSummarySchema.extend({ cancellable: z.boolean(), canCancel: z.boolean(), defaultSort: sortSchema, columns: z.array(explorerColumnSchema) })
export type ExplorerDataset = z.infer<typeof explorerDatasetSchema>

export const explorerPageSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  /** Só para quem pode cancelar, em conjunto cancelável. Linha já cancelada vem sem chave. */
  rowKeys: z.array(z.string().nullable()).nullable(),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  pageSize: z.number(),
  sort: sortSchema,
  timeZone: z.string(),
  durationMs: z.number(),
})
export type ExplorerPage = z.infer<typeof explorerPageSchema>

export const explorerCountSchema = z.object({ count: z.number(), capped: z.boolean(), durationMs: z.number() })
export type ExplorerCount = z.infer<typeof explorerCountSchema>

export const explorerConditionSchema = z.object({
  type: z.literal("condition"),
  column: z.string(),
  operator: explorerOperatorSchema,
  value: z.union([z.string(), z.boolean()]).optional(),
  values: z.array(z.string()).optional(),
})
export type ExplorerConditionRequest = z.infer<typeof explorerConditionSchema>

/** Árvore de filtros: recursiva, então o tipo precisa ser declarado para o zod montar o esquema. */
export type ExplorerGroupRequest = { type: "group"; logic: "AND" | "OR"; children: (ExplorerConditionRequest | ExplorerGroupRequest)[] }
export const explorerGroupSchema: z.ZodType<ExplorerGroupRequest> = z.lazy(() => z.object({ type: z.literal("group"), logic: z.enum(["AND", "OR"]), children: z.array(z.union([explorerConditionSchema, explorerGroupSchema])) }))

export const EXPLORER_RECORD_STATUSES = ["ALL", "ACTIVE", "CANCELLED"] as const
export const explorerRecordStatusSchema = z.enum(EXPLORER_RECORD_STATUSES)
export type ExplorerRecordStatus = z.infer<typeof explorerRecordStatusSchema>

export const explorerRequestSchema = z.object({
  dataset: z.string(),
  recordStatus: explorerRecordStatusSchema.optional(),
  columns: z.array(z.string()).optional(),
  filter: explorerGroupSchema.optional(),
  search: z.string().optional(),
  sort: sortSchema.optional(),
  pageSize: z.number().optional(),
  cursor: z.string().optional(),
})
export type ExplorerRequest = z.infer<typeof explorerRequestSchema>

/** Quais registros um cancelamento alcança: os marcados na tela (`keys`) ou os dos filtros. Nunca os dois, nunca o conjunto inteiro. */
export const cancellationScopeSchema = z.object({ dataset: z.string(), filter: explorerGroupSchema.optional(), search: z.string().optional(), keys: z.array(z.string()).optional() })
export type CancellationScope = z.infer<typeof cancellationScopeSchema>

const blockerSchema = z.object({ code: z.string(), message: z.string() })

export const cancellationPreviewSchema = z.object({
  rows: z.number(),
  capped: z.boolean(),
  maxRows: z.number(),
  /** O que a pessoa está vendo. A confirmação manda de volta: se os registros mudaram, o servidor recusa. */
  scopeFingerprint: z.string().nullable(),
  executions: z.number(),
  runningExecutions: z.number(),
  stoppedExecutions: z.number(),
  evidences: z.number(),
  feedbacks: z.number(),
  workflowsOnReload: z.number(),
  wholeDataset: z.boolean(),
  blockers: z.array(blockerSchema),
  notices: z.array(z.string()),
  canCancel: z.boolean(),
})
export type CancellationPreview = z.infer<typeof cancellationPreviewSchema>

export const cancellationResultSchema = z.object({ cancellationId: z.string(), rows: z.number() })
export type CancellationResult = z.infer<typeof cancellationResultSchema>

export const cancellationItemSchema = z.object({
  id: z.string(),
  reason: z.string(),
  rows: z.number(),
  remaining: z.number(),
  createdAt: z.string(),
  cancelledBy: z.string().nullable(),
  reactivatedAt: z.string().nullable(),
  reactivatedBy: z.string().nullable(),
  reactivatedRows: z.number().nullable(),
})
export type CancellationItem = z.infer<typeof cancellationItemSchema>
export const cancellationListSchema = z.object({ items: z.array(cancellationItemSchema), hasMore: z.boolean() })
export type CancellationList = z.infer<typeof cancellationListSchema>

export const reactivationPreviewSchema = z.object({
  rows: z.number(),
  problems: z.array(z.object({ code: z.string(), count: z.number(), message: z.string() })),
  blockers: z.array(blockerSchema),
  notices: z.array(z.string()),
  canReactivate: z.boolean(),
})
export type ReactivationPreview = z.infer<typeof reactivationPreviewSchema>

export const reactivationResultSchema = z.object({ rows: z.number() })
export type ReactivationResult = z.infer<typeof reactivationResultSchema>

export const deletedItemSchema = z.object({ type: z.string(), typeLabel: z.string(), id: z.string(), name: z.string(), deletedAt: z.string(), deletedBy: z.string().nullable() })
export type DeletedItem = z.infer<typeof deletedItemSchema>

export const deletedItemListSchema = z.object({ items: z.array(deletedItemSchema), hasMore: z.boolean() })
export type DeletedItemList = z.infer<typeof deletedItemListSchema>

export const restorationPreviewSchema = z.object({
  item: deletedItemSchema,
  problems: z.array(z.object({ code: z.string(), message: z.string() })),
  notices: z.array(z.string()),
  canRestore: z.boolean(),
})
export type RestorationPreview = z.infer<typeof restorationPreviewSchema>

export const restorationResultSchema = z.object({ type: z.string(), id: z.string(), name: z.string(), notices: z.array(z.string()) })
export type RestorationResult = z.infer<typeof restorationResultSchema>
