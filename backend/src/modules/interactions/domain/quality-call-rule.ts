/**
 * REGRA GERAL DE CHAMADA CURTA — `QUALITY_CALL_MIN_DURATION_V1` (migration 246).
 *
 * Chamada abaixo da duração mínima da organização não serve para avaliar QUALIDADE: não é sorteada na monitoria aleatória do
 * Workflow e não entra no levantamento de boas práticas. Duração = fim − início da interação (o contrato da Central de Dados exige
 * os dois). Sem duração conhecida, a chamada não prova que não é curta e fica fora. Mínimo 0 = regra desligada (toda chamada entra).
 *
 * NÃO vale para o gatilho por Flag nem para a investigação de indicador: ali a chamada é diagnóstico (uma desconexão curta é
 * justamente o que importa).
 */
export const QUALITY_CALL_RULE_VERSION = "QUALITY_CALL_MIN_DURATION_V1" as const
export const DEFAULT_MINIMUM_QUALITY_CALL_SECONDS = 60
export const MINIMUM_QUALITY_CALL_SECONDS_LIMITS = { min: 0, max: 600 } as const

/** A chamada pode entrar numa análise de qualidade? */
export function isQualityCallDuration(durationSeconds: number | null, minimumSeconds: number): boolean {
  if (minimumSeconds <= 0) return true
  return durationSeconds !== null && durationSeconds >= minimumSeconds
}

/**
 * O mesmo critério em SQL, sobre uma tabela `interactions` com o apelido dado; `param` é o índice do parâmetro com o mínimo
 * em segundos (inteiro). Uma única definição para quem filtra no banco.
 */
export function qualityCallSqlPredicate(alias: string, param: number): string {
  return `($${param}::int <= 0 or (${alias}.ended_at is not null and extract(epoch from (${alias}.ended_at - ${alias}.started_at)) >= $${param}::int))`
}

/** Frase da regra, para relatório e tela. */
export function describeQualityCallRule(minimumSeconds: number): string {
  return minimumSeconds <= 0
    ? "Regra de chamada curta desligada: toda chamada pode entrar na análise de qualidade."
    : `Chamadas com menos de ${minimumSeconds} s (ou sem duração conhecida) ficam fora da análise de qualidade.`
}
