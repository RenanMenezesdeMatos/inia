import type { InvestigationObjectiveKind } from "./investigation-objective.js"
import { bucketIndexOf, temporalBucketsOf } from "./temporal-semantics.js"
import { LONG_PERIOD_DAYS, temporalBucketCountOf } from "./interaction-analysis.js"

/**
 * AMOSTRAGEM DEPENDE DA PERGUNTA (V1.3.2 — Parte 4). RECENT responde "o que aconteceu recentemente?";
 * uma janela longa com pergunta de padrão/evolução precisa de amostra distribuída no tempo — senão o
 * modelo só vê o fim do período e "evolução" fica estruturalmente inobservável. O runtime decide a
 * estratégia padrão a partir do objetivo e do tamanho da janela (o modelo pode pedir outra explicitamente);
 * a seleção é DETERMINÍSTICA (ordenação estável + rodízio por bloco): mesmo input → mesma amostra.
 * Nenhuma estratégia aumenta o teto de itens — só muda QUAIS entram.
 */
export const SAMPLING_STRATEGIES = ["RECENT", "TEMPORAL_STRATIFIED", "SUBJECT_STRATIFIED", "FLAG_STRATIFIED"] as const
export type SamplingStrategy = (typeof SAMPLING_STRATEGIES)[number]

/** Regra do runtime: janela longa + objetivo de padrão/causa/comparação → temporal; senão recente. Nunca por conteúdo. */
export function defaultSamplingStrategy(objective: InvestigationObjectiveKind, periodDays: number): SamplingStrategy {
  const patternLike = objective === "IDENTIFY_EMPLOYEE_PATTERN" || objective === "EXPLAIN_INDICATOR_DEVIATION" || objective === "COMPARE_WITH_POPULATION" || objective === "MULTI_DOMAIN_DIAGNOSIS"
  return patternLike && periodDays > LONG_PERIOD_DAYS ? "TEMPORAL_STRATIFIED" : "RECENT"
}

export type SamplingMetadata = {
  strategy: SamplingStrategy
  candidateCount: number
  selectedCount: number
  /** Blocos temporais da janela (rótulos de data, sem ids). */
  periodBuckets: { from: string; to: string; candidates: number }[]
  selectedPerBucket: number[]
  selectionReason: string
}

export type SamplingInput<T> = {
  candidates: T[]
  strategy: SamplingStrategy
  limit: number
  period: { start: Date; end: Date }
  periodDays: number
  startedAtOf: (item: T) => Date
  /** Desempate estável (ex.: id) — garante determinismo quando dois itens têm o mesmo instante. */
  keyOf: (item: T) => string
  subjectOf?: (item: T) => string
  hasFlagOf?: (item: T) => boolean
  /** Rótulo de data local para os blocos (fuso da organização). */
  dateLabelOf: (date: Date) => string
}

export function selectSample<T>(input: SamplingInput<T>): { selected: T[]; metadata: SamplingMetadata } {
  const limit = Math.max(0, input.limit)
  // Ordenação estável: mais recente primeiro; empate pela chave.
  const ordered = [...input.candidates].sort((a, b) => input.startedAtOf(b).getTime() - input.startedAtOf(a).getTime() || input.keyOf(a).localeCompare(input.keyOf(b)))
  const bucketCount = temporalBucketCountOf(input.periodDays)
  // Mesma divisão de blocos da semântica temporal (V1.3.4) — candidato fora da janela cai no bloco mais próximo (como antes).
  const bucketOf = (item: T) => bucketIndexOf(input.startedAtOf(item), input.period, bucketCount, input.dateLabelOf) ?? (input.startedAtOf(item).getTime() < input.period.start.getTime() ? 0 : bucketCount - 1)
  const periodBuckets = temporalBucketsOf(input.period, bucketCount, input.dateLabelOf).map((bucket) => ({ from: bucket.from, to: bucket.to, candidates: ordered.filter((item) => bucketOf(item) === bucket.index).length }))
  const groupsFor = (strategy: SamplingStrategy): T[][] => {
    if (strategy === "TEMPORAL_STRATIFIED") return Array.from({ length: bucketCount }, (_, index) => ordered.filter((item) => bucketOf(item) === index)).reverse() // do bloco mais recente ao mais antigo
    if (strategy === "SUBJECT_STRATIFIED" && input.subjectOf) {
      const bySubject = new Map<string, T[]>()
      for (const item of ordered) {
        const subject = input.subjectOf(item)
        bySubject.set(subject, [...(bySubject.get(subject) ?? []), item])
      }
      return [...bySubject.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([, items]) => items)
    }
    if (strategy === "FLAG_STRATIFIED" && input.hasFlagOf) return [ordered.filter((item) => input.hasFlagOf!(item)), ordered.filter((item) => !input.hasFlagOf!(item))]
    return [ordered]
  }
  const groups = groupsFor(input.strategy).filter((group) => group.length > 0)
  // Rodízio: uma de cada grupo por vez (o mais recente restante de cada), até o teto.
  const selected: T[] = []
  const cursors = groups.map(() => 0)
  while (selected.length < limit) {
    let progressed = false
    for (let index = 0; index < groups.length && selected.length < limit; index += 1) {
      const group = groups[index]!
      const cursor = cursors[index]!
      if (cursor >= group.length) continue
      selected.push(group[cursor]!)
      cursors[index] = cursor + 1
      progressed = true
    }
    if (!progressed) break
  }
  // Saída na ordem cronológica inversa (como RECENT), para o modelo ler do mais novo ao mais antigo.
  selected.sort((a, b) => input.startedAtOf(b).getTime() - input.startedAtOf(a).getTime() || input.keyOf(a).localeCompare(input.keyOf(b)))
  const selectedPerBucket = periodBuckets.map((_, index) => selected.filter((item) => bucketOf(item) === index).length)
  const selectionReason =
    input.strategy === "TEMPORAL_STRATIFIED"
      ? `janela de ${input.periodDays} dias em ${bucketCount} bloco(s): rodízio entre blocos para cobrir o período inteiro (não só o fim)`
      : input.strategy === "SUBJECT_STRATIFIED"
        ? "rodízio entre assuntos (do mais frequente ao menos frequente) para não concentrar a amostra em um só assunto"
        : input.strategy === "FLAG_STRATIFIED"
          ? "rodízio entre interações com flag registrada e sem flag"
          : `janela de ${input.periodDays} dias: as mais recentes`
  return { selected, metadata: { strategy: input.strategy, candidateCount: input.candidates.length, selectedCount: selected.length, periodBuckets, selectedPerBucket, selectionReason } }
}

/** Dias civis (aprox.) de uma janela [start, end). */
export function periodDaysOf(period: { start: Date; end: Date }): number {
  return Math.max(1, Math.round((period.end.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000)))
}
