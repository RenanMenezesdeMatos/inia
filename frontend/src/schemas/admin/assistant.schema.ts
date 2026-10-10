import { z } from "zod"
import { businessDomainRefSchema } from "./business-domain.schema"
import { agentSpecialtySchema, orchestratorPolicyKindSchema, routingPolicyKindSchema, specialtyKindSchema } from "./orchestrator-policy"
import { outputSchemaSchema } from "./output-schema-fields"
import { structuredOutputDefinitionSchema, structuredOutputReviewSchema, structuredOutputSourceSchema } from "./structured-output"

const flatOutputSchemaFieldSchema = z.object({
  path: z.string(),
  label: z.string(),
  type: z.enum(["STRING", "NUMBER", "BOOLEAN", "ARRAY"]),
  enumValues: z.array(z.string()).optional(),
  description: z.string().optional(),
  fieldType: z.enum(["STRING", "NUMBER", "BOOLEAN", "ENUM", "ARRAY"]).optional(),
  required: z.boolean().optional(),
  enumOptions: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
})

const orchestratorSpecialistSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  agentType: z.string(),
  specialty: agentSpecialtySchema.nullable().catch(null),
  specialtyKind: specialtyKindSchema.nullable().catch(null),
  domain: z.string().nullable().catch(null),
  businessDomainId: z.string().nullable().catch(null),
  businessDomain: businessDomainRefSchema.nullable().catch(null),
  capability: z.string().nullable().catch(null),
})
export type OrchestratorSpecialist = z.infer<typeof orchestratorSpecialistSchema>

export const orchestratorInvocationModeSchema = z.enum(["INTERACTIVE", "WORKFLOW", "BOTH"])
export type OrchestratorInvocationMode = z.infer<typeof orchestratorInvocationModeSchema>

export const ORCHESTRATOR_INVOCATION_MODE_LABELS: Record<OrchestratorInvocationMode, string> = {
  INTERACTIVE: "Só chat/voz do operador",
  WORKFLOW: "Só workflows",
  BOTH: "Chat/voz do operador e workflows",
}

export const orchestratorSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  createdAt: z.coerce.string(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  orchestratorAgentId: z.string(),
  orchestratorAgentName: z.string(),
  specialists: z.array(orchestratorSpecialistSchema),
  invocationMode: orchestratorInvocationModeSchema,
  /** Legado (034/035) — ainda devolvidos; com `structuredOutput` presente são GERADOS pelo backend. */
  outputInstructions: z.string().nullable(),
  outputSchema: outputSchemaSchema.nullable(),
  /** FONTE ÚNICA DA VERDADE do resultado estruturado (071): definição efetiva (persistida ou
   * reconstruída do legado), de onde veio, revisão pendente de legado divergente e o catálogo
   * de campos já achatado (paths + "Grupo › Campo") que o Workflow Builder consome. */
  structuredOutput: structuredOutputDefinitionSchema.nullable().catch(null),
  structuredOutputSource: structuredOutputSourceSchema.catch("NONE"),
  structuredOutputReview: structuredOutputReviewSchema.nullable().catch(null),
  structuredOutputFields: z.array(flatOutputSchemaFieldSchema).nullable().catch(null),
  /** Legado (053/054) — mantido e escrito pelo backend (dual-write) durante a transição. */
  policyKind: orchestratorPolicyKindSchema.nullable().catch(null),
  policyDomains: z.array(z.string()).catch([]),
  /** Forma alvo (057/060): DOMAINS + domínios (1..N, `businessDomains` do catálogo; `routingDomains` = códigos legados dual-write) ou OPEN; null = legado ainda não traduzido (TRANSVERSAL/MANAGERIAL/sem política). */
  routingPolicy: routingPolicyKindSchema.nullable().catch(null),
  routingDomains: z.array(z.string()).catch([]),
  businessDomains: z.array(businessDomainRefSchema).catch([]),
  /** "Nas respostas finais, o Orquestrador pode selecionar e recomendar materiais encontrados pelos especialistas?" — padrão false. */
  recommendSupportMaterials: z.boolean().catch(false),
})
export type Orchestrator = z.infer<typeof orchestratorSchema>
