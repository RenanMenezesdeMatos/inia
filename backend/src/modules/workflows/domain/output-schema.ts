import { z } from "zod"
import { escalationRoleSchema, type EscalationRole } from "./escalation-role-schema.js"

/**
 * Quem recebe a saída de um node Output — desacoplado de "onde aparece" (OutputSurface) e de
 * "que agente/gatilho a gerou". Modelado por capacidade (a posição na hierarquia de quem
 * disparou o workflow), não por id fixo de pessoa, para não precisar reconfigurar o workflow
 * quando alguém muda de cargo.
 */
export const outputTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CURRENT_OPERATOR") }),
  z.object({ type: z.literal("SUPERVISOR_OF_OPERATOR") }),
  z.object({ type: z.literal("MANAGER_OF_OPERATOR") }),
  z.object({ type: z.literal("ROLE"), role: escalationRoleSchema }),
  z.object({ type: z.literal("USER"), userId: z.string().uuid() }),
])
export type OutputTarget = z.infer<typeof outputTargetSchema>

/** Cargo que um destinatário de gestão pede — `null` pra "O próprio operador" e "Pessoa
 * específica", que não passam pela hierarquia. Compartilhado por validação de publicação e
 * runtime (output-executor.ts), pra os dois lerem o target do mesmo jeito. */
export function outputTargetRole(target: OutputTarget): EscalationRole | null {
  switch (target.type) {
    case "SUPERVISOR_OF_OPERATOR":
      return "SUPERVISOR"
    case "MANAGER_OF_OPERATOR":
      return "MANAGER"
    case "ROLE":
      return target.role
    default:
      return null
  }
}

/** Onde a saída aparece — independente de quem recebe. Um mesmo Output pode publicar em mais
 * de uma superfície (ex.: FOLLOW_UP + AVATAR). */
export const outputSurfaceSchema = z.enum(["FOLLOW_UP", "AVATAR", "CHAT", "INBOX", "NOTIFICATION", "CUSTOM_SURFACE"])
export type OutputSurface = z.infer<typeof outputSurfaceSchema>

/** Só relevante quando "AVATAR"/"CHAT" está entre as surfaces — como o avatar se comporta ao
 * ganhar essa saída. PROMPT é o padrão recomendado (nunca interrompe o operador sem avisar). */
export const avatarInteractionModeSchema = z.enum(["PASSIVE", "PROMPT", "IMMEDIATE"])
export type AvatarInteractionMode = z.infer<typeof avatarInteractionModeSchema>

export const outputNodeConfigSchema = z.object({
  target: outputTargetSchema,
  surfaces: z.array(outputSurfaceSchema).min(1),
  interactionMode: avatarInteractionModeSchema.optional(),
  // Caminho dentro do Execution Context com o conteúdo a publicar — mesma convenção do
  // "sourcePath" de Condition (ex.: "nodeOutputs.<idDoNodeAgente>").
  source: z.string().trim().min(1),
  /**
   * "Esta entrega deve apresentar os materiais de apoio que JÁ foram recomendados pelo
   * Agent/Orquestrador do node de origem?" — decisão da SUPERFÍCIE, separada de "quem recomenda"
   * (configuração do Agent/Orquestrador). Só faz sentido em surfaces que renderizam a recomendação
   * (hoje: FOLLOW_UP — Acompanhamento/Feedback do próprio operador). Ausente = false: Workflows
   * existentes (inclusive os 22 modelos) não mudam de comportamento.
   */
  includeSupportMaterials: z.boolean().optional(),
})
export type OutputNodeConfig = z.infer<typeof outputNodeConfigSchema>
