import { z } from "zod"

/**
 * Contrato da aba Estrutura do perfil e da navegação progressiva — espelho de
 * `org-structure/application/person-organization-structure.ts` no backend. O frontend valida na
 * borda e apresenta: cadeia, subordinados diretos, capabilities de cada pessoa, contagem com
 * significado e origem já vêm decididos. Nenhuma permissão é derivada aqui.
 */
export const structurePersonCapabilitiesSchema = z.object({
  canViewProfile: z.boolean(),
  canViewStructure: z.boolean(),
  hasReports: z.boolean(),
})
export type StructurePersonCapabilities = z.infer<typeof structurePersonCapabilitiesSchema>

const unitSchema = z.object({ id: z.string(), name: z.string() })

/**
 * MÉTRICAS GERENCIAIS de um líder (aba "Dados da estrutura" do card) — espelho de
 * `org-structure/domain/management-metrics.ts`. Denominador, percentuais (1 casa decimal),
 * buckets, supressão de agregados sensíveis e "não confirmado" já chegam DECIDIDOS: o frontend
 * só rotula e apresenta — nunca escolhe um denominador próprio nem infere pelo cargo.
 */
export const structureStatusBucketSchema = z.enum(["EM_PRODUCAO", "FERIAS", "INSS", "MATERNIDADE", "PATERNIDADE", "SENSITIVE_LEAVE", "OTHER", "UNCONFIRMED"])
export type StructureStatusBucket = z.infer<typeof structureStatusBucketSchema>

export const STRUCTURE_STATUS_BUCKET_LABELS: Record<StructureStatusBucket, string> = {
  EM_PRODUCAO: "Em produção",
  FERIAS: "Férias",
  INSS: "INSS",
  MATERNIDADE: "Maternidade",
  PATERNIDADE: "Paternidade",
  SENSITIVE_LEAVE: "Afastamento (motivo protegido)",
  OTHER: "Outras situações",
  UNCONFIRMED: "Não confirmado",
}

export const layerMetricSchema = z.object({ managerRole: z.string(), reportRole: z.string(), managers: z.number().int().nonnegative(), reports: z.number().int().nonnegative(), average: z.number().nonnegative() })
export type LayerMetric = z.infer<typeof layerMetricSchema>

export const groupBenchmarkSchema = z.object({ groupId: z.string(), groupName: z.string(), peerRole: z.string(), peerCount: z.number().int().nonnegative(), averageDirectSpan: z.number().nonnegative() })
export type GroupBenchmark = z.infer<typeof groupBenchmarkSchema>

export const managementMetricsSchema = z.object({
  /** Denominador único de todos os percentuais: cadastros ativos abaixo do líder, qualquer profundidade e cargo. */
  structuralPopulation: z.number().int().nonnegative(),
  /** Em ordem de exibição; a soma dos `count` é a população estrutural. */
  statusDistribution: z.array(z.object({ bucket: structureStatusBucketSchema, count: z.number().int().nonnegative(), percent: z.number().nonnegative() })),
  /** Span de controle = subordinados diretos (reports_to_id), qualquer cargo. */
  directSpan: z.number().int().nonnegative(),
  /** Abrangência operacional = operadores abaixo, qualquer profundidade. */
  operatorReach: z.number().int().nonnegative(),
  roleCounts: z.array(z.object({ role: z.string(), count: z.number().int().nonnegative() })),
  layerMetrics: z.array(layerMetricSchema),
  groupBenchmark: groupBenchmarkSchema.nullable(),
  privacy: z.object({ sensitiveBreakdownSuppressed: z.boolean(), minimumPopulation: z.number().int().positive() }),
  confidence: z.object({ statusFreshness: z.enum(["FRESH", "STALE", "UNKNOWN"]), unconfirmed: z.number().int().nonnegative() }),
})
export type ManagementMetrics = z.infer<typeof managementMetricsSchema>

/** Plural por cargo, para "4 Coordenadores · 20 Supervisores · 487 Operadores". */
export const ROLE_PLURAL_LABELS: Record<string, [singular: string, plural: string]> = {
  DIRECTOR: ["Diretor", "Diretores"],
  SENIOR_MANAGER: ["Gerente Sênior", "Gerentes Sêniores"],
  MANAGER: ["Gerente", "Gerentes"],
  COORDINATOR: ["Coordenador", "Coordenadores"],
  SUPERVISOR: ["Supervisor", "Supervisores"],
  OPERATOR: ["Operador", "Operadores"],
  ADMIN: ["Administrador", "Administradores"],
}

/** A unidade de gestão por cargo, para "25,4 operadores / supervisão". */
export const ROLE_UNIT_LABELS: Record<string, string> = {
  DIRECTOR: "diretoria",
  SENIOR_MANAGER: "gerência sênior",
  MANAGER: "gerência",
  COORDINATOR: "coordenação",
  SUPERVISOR: "supervisão",
  OPERATOR: "operador",
  ADMIN: "administração",
}

export const structurePersonSchema = z.object({
  personId: z.string(),
  name: z.string(),
  role: z.string(),
  roleLabel: z.string(),
  jobTitle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  email: z.string().nullable(),
  /** `null` = não informado; ausente = fora do que o viewer enxerga (a linha não é mostrada). */
  group: unitSchema.nullable().optional(),
  subgroup: unitSchema.nullable().optional(),
  operationalCapital: z.object({ code: z.string(), name: z.string(), stateCode: z.string(), label: z.string() }).nullable().optional(),
  /** Subordinados diretos ativos; null quando a pessoa está acima do que o viewer enxerga. */
  directReportCount: z.number().int().nonnegative().nullable(),
  capabilities: structurePersonCapabilitiesSchema,
  /** `null` = o viewer não pode ver (Operador) ou a pessoa não lidera; ausente = node que nunca expande (gestor acima, cadeia). */
  managementMetrics: managementMetricsSchema.nullable().optional(),
})
export type StructurePerson = z.infer<typeof structurePersonSchema>

export const structureChainEntrySchema = structurePersonSchema.extend({ level: z.number().int().positive() })
export type StructureChainEntry = z.infer<typeof structureChainEntrySchema>

export const directManagerStatusSchema = z.enum(["PRESENT", "NOT_INFORMED", "INACTIVE"])
export type DirectManagerStatus = z.infer<typeof directManagerStatusSchema>

export const memberCountKindSchema = z.enum(["DIRECT_OPERATORS", "OPERATORS_BELOW"])

export const personOrganizationStructureSchema = z.object({
  subject: structurePersonSchema.extend({ isViewer: z.boolean() }),
  breadcrumb: z.array(z.object({ personId: z.string(), name: z.string(), roleLabel: z.string(), isViewer: z.boolean() })),
  organizationalContext: z.object({
    group: unitSchema.nullable(),
    subgroup: unitSchema.nullable(),
    directManagerStatus: directManagerStatusSchema,
    team: z.object({ label: z.string(), leader: structureChainEntrySchema, memberCount: z.number().int().nonnegative(), memberCountKind: memberCountKindSchema, memberCountLabel: z.string() }).nullable(),
  }),
  /** Gestor imediato → topo (ordem determinística do backend); a UI inverte para desenhar topo → pessoa. */
  managementChain: z.array(structureChainEntrySchema),
  /** Subordinados diretos ativos da pessoa focal — o "contexto imediatamente útil", nunca a subárvore. */
  directReports: z.array(structurePersonSchema),
  /** Cadeia real do viewer (reports_to_id), topo → viewer — metadata para apontar "este caminho leva até você". */
  viewerOrganizationPath: z.array(z.object({ personId: z.string(), name: z.string(), roleLabel: z.string() })),
  sourceMetadata: z.object({ sourceName: z.string(), feedName: z.string(), lastUpdatedAt: z.string().nullable(), freshness: z.enum(["FRESH", "STALE", "UNKNOWN"]) }).nullable(),
})
export type PersonOrganizationStructure = z.infer<typeof personOrganizationStructureSchema>
