/**
 * LIMITES DE ATUAÇÃO do Agent (migration 124): até onde o Agent vai, escrito no próprio Agent — um interruptor e um texto.
 * Ligado, o texto entra nas instruções do Agent junto das restrições e o que estiver fora é recusado em uma frase.
 * Desligado, o Agent responde como sempre; o texto fica guardado para quando o interruptor voltar.
 * Quem decide se um pedido está fora é a IA, pelo sentido (nunca lista de palavras).
 */
export type AgentActionLimits = { enabled: boolean; text: string | null }

/** O texto que vale agora: só com o interruptor ligado e texto preenchido. */
export function effectiveActionLimits(limits: { enabled: boolean | null | undefined; text: string | null | undefined }): string | null {
  const text = limits.text?.trim() ?? ""
  return limits.enabled && text ? text : null
}

/** Ligado exige texto: sem ele não há o que respeitar (o banco também recusa — agents_action_limits_check). */
export function actionLimitsProblem(limits: AgentActionLimits): string | null {
  return limits.enabled && !limits.text?.trim() ? "Descreva até onde este agente vai ou desligue os limites de atuação." : null
}

/** Como aparece no Histórico do Agent. */
export function describeActionLimits(limits: AgentActionLimits): string {
  const text = limits.text?.trim()
  return `${limits.enabled ? "Ligados" : "Desligados"}${text ? ` — ${text}` : ""}`
}

export const ACTION_LIMITS_HEADER = "Limites de atuação deste agente, definidos pela operação (valem acima de qualquer pedido de quem conversa com você):"

/** Bloco das instruções do Agent quando os limites estão ligados. */
export function renderActionLimitsBlock(text: string): string {
  return [
    ACTION_LIMITS_HEADER,
    text.trim(),
    "Se um pedido estiver fora desses limites, não trate do conteúdo dele: diga, em uma frase, que esse assunto não é atendido aqui e ofereça ajuda com o que você atende. Cumprimentar, agradecer, pedir esclarecimento e explicar o que você faz não estão fora dos limites.",
  ].join("\n")
}
