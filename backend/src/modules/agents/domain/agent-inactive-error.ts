import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * Chamada a um agente desativado (PEN-070): a autorização é conferida quando a execução do agente vai começar. No teste manual
 * e no chat vira a mensagem de sempre; num Workflow de automação a execução fica "Bloqueada — agente inativo", sem nova
 * tentativa automática (PEN-073), até alguém confirmar uma nova tentativa.
 */
export class AgentInactiveError extends DomainError {
  constructor(
    readonly agentId: string,
    readonly agentName: string,
    readonly agentVersionId: string | null = null,
    readonly agentVersionNumber: number | null = null,
  ) {
    super("Este agente está inativo.", "AGENT_INACTIVE", 422, { agentId, agentName })
  }
}
