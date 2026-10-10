/**
 * ESTRATÉGIA EM VIGOR NO NASCIMENTO DE UMA EXECUÇÃO (`STRATEGY_AT_BIRTH_V1`) — funções puras.
 *
 * Regra da V1.6.2: a versão da estratégia em vigor quando a execução NASCE fica fixa até o fim dela. A matrícula por Indicador (e a
 * execução manual a partir de uma medição) grava essa versão numa coluna — que só serve a UM indicador, o da medição. Agenda,
 * execução manual por colaborador e filhos de fan-out podem diagnosticar qualquer indicador (o fechamento do PRV cobre vários, e
 * quais só se sabe ao ler o fechamento): para eles a versão é DEDUZIDA, por indicador, do instante de nascimento — sem coluna nova,
 * porque tudo de que a dedução depende é imutável ou histórico:
 *   - versão publicada nunca muda nem é apagada (trigger da migration 086) e `published_at` é gravado uma única vez — a versão em
 *     vigor num instante é a de publicação mais recente até ele (a anterior só virou SUPERSEDED depois);
 *   - ativar/desativar a estratégia muda o cabeçalho e é auditado na MESMA transação (`setStrategyActive`) — o estado num instante
 *     é o do último evento até ele.
 */
export type PublishedStrategyVersion = { version: number; publishedAt: Date | null }

/** A versão em vigor no instante: a de publicação mais recente até ele (rascunho nunca). null = nada publicado até então. */
export function versionInForceAt<T extends PublishedStrategyVersion>(versions: readonly T[], at: Date): T | null {
  let best: { version: T; publishedAt: number } | null = null
  for (const candidate of versions) {
    const publishedAt = candidate.publishedAt?.getTime()
    if (publishedAt === undefined || publishedAt > at.getTime()) continue
    if (!best || publishedAt > best.publishedAt || (publishedAt === best.publishedAt && candidate.version > best.version.version)) best = { version: candidate, publishedAt }
  }
  return best?.version ?? null
}

export type StrategyActivationEvent = { active: boolean; at: Date }

/**
 * A estratégia estava ATIVA no instante? Cada evento registra o estado RESULTANTE (ativar uma já ativa também é evento — por isso
 * nunca se deduz "o contrário do próximo evento"):
 *   - último evento até o instante → o estado dele;
 *   - só eventos depois do instante → ativa (o cabeçalho nasce ativo e a primeira mudança veio depois);
 *   - nenhum evento → o estado atual (nunca mudou pela aplicação; inativa sem evento = mudança feita fora dela, sem data — fica sem
 *     estratégia, como uma execução sem pino ficava antes desta regra).
 * Quem já sabe que o cabeçalho não mudou depois do instante passa `events` vazio: o estado atual é o daquele instante.
 */
export function strategyActiveAt(input: { currentActive: boolean; events: readonly StrategyActivationEvent[]; at: Date }): boolean {
  if (input.events.length === 0) return input.currentActive
  const until = input.events.filter((event) => event.at.getTime() <= input.at.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())
  return until.length > 0 ? until[until.length - 1]!.active : true
}
