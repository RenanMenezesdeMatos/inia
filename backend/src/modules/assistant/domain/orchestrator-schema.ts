import { z } from "zod"
import { outputSchemaSchema } from "./output-schema-fields.js"
import { businessDomainCodeSchema } from "../../business-domains/domain/business-domain.js"
import { orchestratorPolicyKindSchema, routingPolicyKindSchema } from "./orchestrator-policy.js"

// Padrão BOTH preserva o comportamento de todo orquestrador cadastrado antes deste campo
// existir — restringir a um dos dois lados é uma escolha explícita do admin.
export const orchestratorInvocationModeSchema = z.enum(["INTERACTIVE", "WORKFLOW", "BOTH"])

export const createOrchestratorSchema = z.object({
  name: z.string().trim().min(2),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).default("ALL_TEAMS"),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  orchestratorAgentId: z.string().uuid(),
  specialistAgentIds: z.array(z.string().uuid()).default([]),
  invocationMode: orchestratorInvocationModeSchema.default("BOTH"),
  // Texto livre, opcional — quando presente, pede ao modelo um JSON estruturado (formato dado
  // por este texto) ao final da resposta, além do texto normal. Ver run-orchestrated-reply.ts.
  outputInstructions: z.string().trim().min(1).nullable().optional(),
  // Descrição tipada opcional do MESMO formato pedido em outputInstructions — não instrui o
  // modelo (isso continua sendo outputInstructions), só alimenta o Workflow Builder com
  // label/type/enumValues por campo. Ver output-schema-fields.ts.
  outputSchema: outputSchemaSchema.nullable().optional(),
  // FONTE ÚNICA DA VERDADE do resultado estruturado (migration 071, structured-output-definition.ts):
  // quando presente, o backend GERA outputInstructions/outputSchema a partir dela (dual-write) —
  // o admin nunca edita os dois. Chega como `unknown` de propósito: a validação com mensagens
  // humanas ("Já existe um campo chamado…") é feita por parseStructuredOutputDefinition no router.
  structuredOutput: z.unknown().optional(),
  // Política de roteamento (forma alvo, migration 057/060): DOMAINS + domínios (1..N) ou OPEN.
  // Os domínios chegam por ID do catálogo (`routingDomainIds`, forma alvo) ou por CÓDIGO
  // (`routingDomains`, compatibilidade) — o backend resolve os dois contra `business_domains`.
  routingPolicy: routingPolicyKindSchema.nullable().optional(),
  routingDomainIds: z.array(z.string().uuid()).optional(),
  routingDomains: z.array(businessDomainCodeSchema).optional(),
  // Forma legada (053) — aceita por compatibilidade; quando `routingPolicy` vem, prevalece.
  policyKind: orchestratorPolicyKindSchema.nullable().optional(),
  policyDomains: z.array(businessDomainCodeSchema).optional(),
  /** "Nas respostas finais, o Orquestrador pode selecionar e recomendar materiais encontrados
   * pelos especialistas?" — padrão false; não altera roteamento, especialistas nem síntese. */
  recommendSupportMaterials: z.boolean().optional(),
})

export const updateOrchestratorSchema = z.object({
  name: z.string().trim().min(2).optional(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).optional(),
  teamId: z.string().uuid().nullable().optional(),
  subteamId: z.string().uuid().nullable().optional(),
  orchestratorAgentId: z.string().uuid().optional(),
  specialistAgentIds: z.array(z.string().uuid()).optional(),
  /** PEN-050: versão do Orquestrador em que a edição se baseou. Outra gravação no meio = 409, nada gravado. */
  expectedVersionId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  invocationMode: orchestratorInvocationModeSchema.optional(),
  outputInstructions: z.string().trim().min(1).nullable().optional(),
  outputSchema: outputSchemaSchema.nullable().optional(),
  structuredOutput: z.unknown().optional(),
  // Mudança potencialmente breaking (apagar/renomear campo, mudar tipo, tirar opção) usada por
  // um Workflow em RASCUNHO só passa com esta confirmação explícita; dependência de versão
  // PUBLICADA é sempre bloqueada (ver structured-output-dependencies.ts).
  acknowledgeStructuredOutputImpacts: z.boolean().optional(),
  routingPolicy: routingPolicyKindSchema.nullable().optional(),
  routingDomainIds: z.array(z.string().uuid()).optional(),
  routingDomains: z.array(businessDomainCodeSchema).optional(),
  policyKind: orchestratorPolicyKindSchema.nullable().optional(),
  policyDomains: z.array(businessDomainCodeSchema).optional(),
  recommendSupportMaterials: z.boolean().optional(),
})

/** Function name exposed to o Gemini pra essa tool — precisa ser um identificador estável e
 * válido (letras/números/underscore), então usamos o uuid do agente sem hífen. */
export function toolNameForAgent(agentId: string): string {
  return `agent_${agentId.replace(/-/g, "")}`
}
