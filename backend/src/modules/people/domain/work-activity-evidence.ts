/**
 * EVIDÊNCIA DE ATIVIDADE OPERACIONAL (WorkActivityEvidence) — "houve evidência confiável de que a
 * pessoa realmente trabalhou neste dia?". É o OBSERVADO, em oposição ao PLANEJADO (escala/exceção).
 *
 * O que prova atividade (regra determinística, sem LLM, sem "qualquer medição serve"):
 *   1. INTERAÇÃO real associada ao colaborador (`interactions.operator_id`) cujo início cai no dia
 *      local da organização — a fonte preferencial;
 *   2. MEDIÇÃO diária (DAILY/HOURLY/INTERACTION) de um indicador cuja definição foi EXPLICITAMENTE
 *      configurada como prova de atividade (`indicator_definitions.proves_work_activity = true`),
 *      com volume/amostra > 0 quando informado. Uma linha de Qualidade ou de TMA atrasada NÃO prova
 *      presença por si — só se o cliente marcou aquele indicador como evidência.
 * Nunca por código/nome de indicador: marcar um indicador como evidência é CONFIGURAÇÃO.
 *
 * Anticircularidade: o indicador em cálculo só torna um dia elegível se a sua própria definição
 * estiver marcada como fonte de evidência — "TMA existe → dia elegível → TMA entra" não acontece
 * por acidente.
 */
export type WorkActivityEvidence = {
  /** AAAA-MM-DD no fuso da organização. */
  date: string
  interactionCount: number
  /** Códigos dos indicadores (marcados como evidência) com medição válida no dia. */
  indicatorCodes: string[]
}

/** Fontes de evidência DISPONÍVEIS na organização — decide se "sem evidência" significa algo. */
export type WorkActivityEvidenceSources = {
  /** Existe interação registrada na organização (canal ingerido). */
  interactions: boolean
  /** Indicadores ativos configurados como prova de atividade. */
  indicatorCodes: string[]
}

/** Sem NENHUMA fonte configurada/observada, ausência de evidência não é informação: ninguém é cobrado. */
export function evidenceSourcesEnabled(sources: WorkActivityEvidenceSources): boolean {
  return sources.interactions || sources.indicatorCodes.length > 0
}

export function hasWorkActivity(evidence: WorkActivityEvidence | undefined | null): boolean {
  return !!evidence && (evidence.interactionCount > 0 || evidence.indicatorCodes.length > 0)
}

export function describeWorkActivityEvidence(evidence: WorkActivityEvidence): string {
  const parts: string[] = []
  if (evidence.interactionCount > 0) parts.push(`${evidence.interactionCount} interação(ões)`)
  if (evidence.indicatorCodes.length > 0) parts.push(`medição de ${evidence.indicatorCodes.join(", ")}`)
  return parts.join(" · ")
}
