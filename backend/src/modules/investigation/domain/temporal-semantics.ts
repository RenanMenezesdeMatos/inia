/**
 * SEMÂNTICA TEMPORAL (V1.3.4 — Temporal Semantics & Comparative Investigation; V1.3.4.1 — Relation-Specific
 * Temporal Sufficiency).
 *
 * Duas coisas que nunca se misturam:
 *   TEMPORAL FACT — "a interação I4 ocorreu em 28/07, no bloco B2 (meio da janela)": posição calculada
 *     pela APLICAÇÃO a partir da data, nunca inferida pelo modelo (ordem dos handles, ordem no prompt,
 *     estilo da transcrição ou corpus são irrelevantes);
 *   TEMPORAL RELATION — "aumentou", "passou a", "houve transição", "permaneceu estável", "no início do
 *     período": exige COMPARAÇÃO entre momentos com evidência validada; cobertura temporal (ver dados de
 *     vários blocos) NÃO autoriza relação temporal (afirmar que algo mudou entre eles).
 *
 * V1.3.4.1 — mais uma fronteira: AUSÊNCIA NA AMOSTRA ≠ AUSÊNCIA NO UNIVERSO. "Não observado nas 3 analisadas de
 * B3" (SAMPLE_DIFFERENCE) não é "deixou de ocorrer em B3" (SUPPORTED change). Cada relação (mudança, tendência,
 * estabilidade, concentração, padrões diferentes) tem requisito próprio — não são sinônimos de "as participações
 * diferem". `absenceEstablished` é decidido por regra determinística de cobertura, nunca pelo LLM.
 *
 * Blocos reutilizam a mesma divisão da amostra TEMPORAL_STRATIFIED e da cobertura temporal (janela em
 * N blocos de DIAS LOCAIS inteiros; N = temporalBucketCountOf) — nenhum calendário fixo, nenhum sistema paralelo.
 * Tudo aqui é determinístico; o LLM não calcula, não posiciona e não decide direção.
 * Nada nesta camada conhece fenômenos específicos (silêncio, protocolo…): a pergunta é sempre a mesma —
 * "existe diferença temporal SUSTENTADA entre os blocos comparados?".
 *
 * V1.3.4.2 — TEMPORAL OUTPUT INTEGRITY: "nenhuma diferença sustentada" (NO_DIFFERENCE_SUPPORTED) NÃO é "estabilidade
 * comprovada" (relação STABILITY sustentada). A CONCLUSÃO TEMPORAL AUTORIZADA (`temporalConclusionOf`) é derivada por
 * código das comparações validadas e diz o que o texto final PODE afirmar (`safeMeaning`); o texto entregue, as
 * hipóteses, as premissas de recomendação e as claims são checados CONTRA ela (`checkTemporalConclusionCompatibility`) —
 * o léxico é rede de segurança secundária, nunca a fonte de verdade.
 */
import { supportScopeRank } from "./support-scope.js"
import type { LedgerEntry } from "./evidence-ledger.js"
import type { ClaimScope } from "./tool-trace.js"

export type TemporalBucket = {
  /** Referência model-facing (B1..Bn), na ordem cronológica. */
  ref: string
  index: number
  count: number
  /** Datas locais (rótulo civil, sem instante técnico). */
  from: string
  to: string
  relativePosition: RelativePosition
}

export type RelativePosition = "FIRST" | "MIDDLE" | "LAST" | "SINGLE"

export type TemporalPosition = { localDate: string; bucketRef: string; bucketIndex: number; bucketCount: number; relativePosition: RelativePosition }

export function relativePositionOf(index: number, count: number): RelativePosition {
  if (count <= 1) return "SINGLE"
  if (index <= 0) return "FIRST"
  if (index >= count - 1) return "LAST"
  return "MIDDLE"
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Rótulo local "AAAA-MM-DD" → dia absoluto (calendário civil, sem fuso). */
const dayNumberOf = (label: string): number => Math.round(Date.UTC(Number(label.slice(0, 4)), Number(label.slice(5, 7)) - 1, Number(label.slice(8, 10))) / DAY_MS)
const labelOfDayNumber = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10)

/**
 * Dias LOCAIS da janela [start, end): a divisão em blocos é feita em dias civis inteiros (§17/§18 da V1.3.4.1) — cada
 * data local pertence a UM único bloco e a legenda model-facing nunca mostra intervalos que pareçam sobrepostos
 * ("B1 = 01/06 a 30/06 · B2 = 01/07 a 31/07", nunca "a 01/07 / de 01/07"). `dateLabelOf` = data local no fuso da
 * organização, no formato AAAA-MM-DD.
 */
function windowDaysOf(period: { start: Date; end: Date }, dateLabelOf: (date: Date) => string): { firstDay: number; totalDays: number } {
  const firstDay = dayNumberOf(dateLabelOf(period.start))
  const lastDay = dayNumberOf(dateLabelOf(new Date(Math.max(period.start.getTime(), period.end.getTime() - 1))))
  return { firstDay, totalDays: Math.max(1, lastDay - firstDay + 1) }
}

/** Primeiro dia (offset a partir do início da janela) de cada bloco — blocos de tamanho igual em dias, sobra nos últimos. */
function bucketStartsOf(totalDays: number, bucketCount: number): number[] {
  const count = Math.max(1, bucketCount)
  return Array.from({ length: count }, (_, index) => Math.floor((totalDays * index) / count))
}

/** Índice do bloco de uma data na janela [start, end) dividida em `bucketCount` blocos de dias locais; null fora da janela. */
export function bucketIndexOf(date: Date, period: { start: Date; end: Date }, bucketCount: number, dateLabelOf: (date: Date) => string): number | null {
  if (date.getTime() < period.start.getTime() || date.getTime() >= period.end.getTime()) return null
  const { firstDay, totalDays } = windowDaysOf(period, dateLabelOf)
  const offset = Math.min(totalDays - 1, Math.max(0, dayNumberOf(dateLabelOf(date)) - firstDay))
  const starts = bucketStartsOf(totalDays, bucketCount)
  let index = 0
  for (let candidate = 0; candidate < starts.length; candidate += 1) if (offset >= starts[candidate]!) index = candidate
  return index
}

/** Blocos da janela (mesma divisão da amostra estratificada e da cobertura temporal) — datas locais inclusivas, sem sobreposição. */
export function temporalBucketsOf(period: { start: Date; end: Date }, bucketCount: number, dateLabelOf: (date: Date) => string): TemporalBucket[] {
  const count = Math.max(1, bucketCount)
  const { firstDay, totalDays } = windowDaysOf(period, dateLabelOf)
  const starts = bucketStartsOf(totalDays, count)
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]! - 1 : totalDays - 1
    return { ref: `B${index + 1}`, index, count, from: labelOfDayNumber(firstDay + start), to: labelOfDayNumber(firstDay + Math.max(start, end)), relativePosition: relativePositionOf(index, count) }
  })
}

/** Posição temporal de uma interação — calculada pela aplicação; null quando a data cai fora da janela. */
export function temporalPositionOf(date: Date, period: { start: Date; end: Date }, bucketCount: number, dateLabelOf: (date: Date) => string): TemporalPosition | null {
  const index = bucketIndexOf(date, period, bucketCount, dateLabelOf)
  if (index === null) return null
  const count = Math.max(1, bucketCount)
  return { localDate: dateLabelOf(date), bucketRef: `B${index + 1}`, bucketIndex: index, bucketCount: count, relativePosition: relativePositionOf(index, count) }
}

const POSITION_LABELS: Record<RelativePosition, string> = { FIRST: "início da janela", MIDDLE: "meio da janela", LAST: "fim da janela", SINGLE: "janela inteira" }

/** Bloco model-facing com os períodos da janela — o modelo lê datas e posições calculadas, nunca as inventa. */
export function renderTemporalBuckets(buckets: TemporalBucket[]): string {
  if (buckets.length <= 1) return ""
  return `PERÍODOS DA JANELA (posição calculada pela aplicação — a ordem das interações no texto NÃO indica tempo): ${buckets.map((bucket) => `${bucket.ref} = ${bucket.from} a ${bucket.to} (${POSITION_LABELS[bucket.relativePosition]})`).join(" · ")}`
}

// ---------------------------------------------------------------------------------------------
// Relação temporal declarada numa claim/hipótese (metadata estruturada — nunca só regex no texto).
// ---------------------------------------------------------------------------------------------
export const TEMPORAL_RELATIONS = ["NONE", "EARLIER_VS_LATER", "TREND", "CHANGE", "STABILITY", "TEMPORAL_CONCENTRATION", "POSITION"] as const
export type TemporalRelation = (typeof TEMPORAL_RELATIONS)[number]
export type TemporalClaimMetadata = {
  temporalRelation?: TemporalRelation | undefined
  /** Blocos (B-n) cuja evidência sustenta a relação. */
  evidenceBuckets?: string[] | undefined
  /** Para POSITION: a posição afirmada ("no início/meio/fim do período"). */
  position?: Exclude<RelativePosition, "SINGLE"> | undefined
}

/**
 * LÉXICO de relação temporal de PERÍODO (pt-BR) — só expressões que afirmam posição no período ou mudança entre
 * momentos; fala "no início da chamada" (dentro de uma interação) não entra. Usado para (a) detectar claim temporal
 * sem metadata e (b) varredura transversal (texto final, hipóteses, premissas de recomendação).
 */
const PERIOD_WORDS = /\b(?:per[ií]odo|trimestre|semestre|bimestre|m[êe]s|meses|semanas?|janela|recentes|posteriores|anteriores|iniciais|[úu]ltim[ao]s|primeir[ao]s|ao\s+longo|com\s+o\s+tempo|a\s+partir\s+de)\b/iu
/** Sempre relação de PERÍODO (não precisa de contexto). */
const TEMPORAL_LANGUAGE: RegExp[] = [
  /\b(?:in[ií]cio|come[çc]o|primeir[ao]s?\s+(?:semanas?|meses?|momentos?|fase))\s+d[oa]\s+(?:per[ií]odo|trimestre|m[êe]s|janela|semestre|bimestre)\b/iu,
  /\b(?:fim|final|[úu]ltim[ao]s?\s+(?:semanas?|meses?|momentos?|fase))\s+d[oa]\s+(?:per[ií]odo|trimestre|m[êe]s|janela|semestre|bimestre)\b/iu,
  /\bintera[çc][õo]es\s+(?:iniciais|mais\s+antigas|mais\s+recentes|posteriores|anteriores)\b/iu,
  /\bao\s+longo\s+d[oa]\s+(?:per[ií]odo|trimestre|m[êe]s|janela|semestre|bimestre)\s*,?\s*(?:houve|ocorreu|percebe-se|nota-se|observa-se|observou-se|identificou-se)\b/iu,
  /\b(?:houve|ocorreu|notamos|nota-se|observa-se|observamos|observou-se|identifiquei|identificamos|identificou-se|existe|h[áa])\s+(?:uma\s+)?transi[çc][ãa]o\b|\btransi[çc][ãa]o\s+(?:clara|gradual|de\s+postura|no\s+(?:modelo|padr[ãa]o|estilo)|para\s+um)\b/iu,
  /\b(?<!acompanhar\s|monitorar\s|observar\s|acompanhe\s|monitore\s|acompanhamento\sda\s)(?:evolu(?:iu|[ií]ram)|evolu[çc][ãa]o\s+(?:positiva|negativa|clara|gradual|em\s+dire[çc][ãa]o|d[oa]\s+(?:postura|comportamento|atendimento|padr[ãa]o|conduta)))\b/iu,
  /\b(?:melhorou|piorou|reduziu|diminuiu|aumentou|cresceu|caiu|intensificou|se\s+estabilizou|se\s+consolidou|consolidou)\s+(?:ao\s+longo|entre\s+(?:os\s+)?(?:meses|per[ií]odos|blocos|momentos)|de\s+um\s+m[êe]s|no\s+decorrer|com\s+o\s+tempo|progressivamente|gradualmente)\b/iu,
  /\btend[êe]ncia\s+(?:de\s+)?(?:alta|queda|melhora|piora|aumento|redu[çc][ãa]o)\b/iu,
  /\b(?:permaneceu|manteve-se|se\s+manteve|continuou)\s+est[áa]vel\b|\bestabilidade\s+ao\s+longo\b/iu,
  /\bmomentos?\s+(?:iniciais|finais|anteriores|posteriores)\s+d[oa]\s+(?:per[ií]odo|trimestre|janela)\b/iu,
  // V1.3.4.1: ausência NO PERÍODO ("deixou de ocorrer", "não ocorre mais") e concentração num momento do período — relação, não fato de amostra.
  /\b(?:deixou|deixaram|parou|pararam)\s+de\s+(?:ocorrer|acontecer|aparecer|existir|se\s+repetir)\b/iu,
  /\bn[ãa]o\s+(?:ocorre|acontece|aparece|se\s+repete)\s+mais\b/iu,
  /\b(?:concentr(?:ad[oa]s?|ou-se|a-se|aram-se)|restrit[oa]s?|limitad[oa]s?)\s+(?:apenas\s+|somente\s+|s[óo]\s+)?(?:n[oa]|em|ao)\s+(?:in[ií]cio|come[çc]o|fim|final|meio|primeir[ao]s?\s+(?:semanas?|meses?|momentos?)|[úu]ltim[ao]s?\s+(?:semanas?|meses?|momentos?)|bloco|B\d)\b/iu,
]
/** Relação temporal só quando a MESMA frase fala do período (fora disso é evento dentro de uma chamada). */
const TEMPORAL_LANGUAGE_CONTEXTUAL: RegExp[] = [
  // "passou a" = começou a; "deixou de" fica FORA (em pt-BR também significa "não fez" — "deixou de informar o protocolo").
  /\b(?:passou|passaram)\s+a\b/iu,
  /\bcada\s+vez\s+(?:mais|menos)\b|\bprogressivamente\b|\bgradualmente\b/iu,
  /\b(?:mudan[çc]a|altera[çc][ãa]o)\s+(?:de\s+postura|no\s+(?:padr[ãa]o|comportamento|modelo)|comportamental)\b/iu,
]

/**
 * FAMÍLIA DE ESTABILIDADE (V1.3.4.2 — §16/§17): "permaneceu/se manteve/continuou estável|constante", "mantendo(-se) (a
 * performance) estável / uma estabilidade", "é estável ao longo do período", "estabilidade ao longo/durante/entre os
 * momentos". Só afirmações de ESTABILIDADE ENTRE MOMENTOS: "manteve o cliente informado", "comunicação constante com o
 * cliente", "desvios constantes" NÃO entram (sem adjetivo de estabilidade ligado ao verbo, ou sem âncora de período).
 * Rede de segurança secundária — a fonte de verdade é a conclusão temporal + claims aceitas.
 */
const STABILITY_ADJECTIVE = "(?:est[áa]vel|est[áa]veis|constante|constantes|inalterad[oa]s?|igual|iguais|o\\s+mesmo|a\\s+mesma)"
const STABILITY_LANGUAGE: RegExp[] = [
  // verbo de permanência + adjetivo de estabilidade (até 3 palavras entre eles: "se manteve praticamente constante")
  new RegExp(`\\b(?:permaneceu|permaneceram|permanece|permanecem|manteve-se|mantiveram-se|se\\s+manteve|se\\s+mantiveram|mant[ée]m-se|se\\s+mant[ée]m|continuou|continuaram|continua|continuam|seguiu|segue|ficou|ficaram)(?:\\s+\\S+){0,3}?\\s+${STABILITY_ADJECTIVE}\\b`, "iu"),
  // "mantendo(-se) (a performance | uma) estável/estabilidade/constante" · "manteve a performance estável"
  new RegExp(`\\b(?:mantendo(?:-se)?|manteve|mantiveram|mant[ée]m|manter|mantido|mantida)(?:\\s+\\S+){0,4}?\\s+(?:${STABILITY_ADJECTIVE}|estabilidade|est[áa]veis)\\b`, "iu"),
  // "é/foi/está estável|constante|consistente ao longo|durante|entre os (meses|blocos|períodos)|em todo o período"
  new RegExp(`(?<!\\p{L})(?:é|foi|est[áa]|esteve|era|eram|s[ãa]o|foram|estavam)(?:\\s+\\S+){0,2}?\\s+(?:${STABILITY_ADJECTIVE}|consistente|consistentes)\\s+(?:ao\\s+longo|durante|entre\\s+(?:os|as)\\s+(?:meses|blocos|per[ií]odos|momentos|semanas)|em\\s+tod[oa]s?\\s+(?:o|os|a|as)\\s+(?:per[ií]odo|meses|blocos|trimestre|momentos))\\b`, "iu"),
  // "estabilidade ao longo / durante / entre os momentos / no(s) comportamento(s) / comportamental / do comportamento"
  /\bestabilidade\s+(?:ao\s+longo|durante|entre\s+(?:os|as)\s+(?:meses|blocos|per[ií]odos|momentos)|n[oa]s?\s+(?:comportamentos?|condutas?|padr(?:[ãa]o|[õo]es)|per[ií]odo|trimestre|desempenho|performance|atendimentos?)|comportamental|d[oa]\s+(?:comportamento|conduta|padr[ãa]o|desempenho|performance|atendimento))\b/iu,
  /\bse\s+estabilizou\b|\bse\s+consolidou\b/iu,
]
/** Negação que governa a expressão na MESMA oração ("não é possível confirmar … estabilidade", "sem evidência de estabilidade"). */
const NEGATION_CUE = /\b(?:n[ãa]o|nem|nunca|sem|imposs[ií]vel|insuficiente[s]?|inconclusiv[oa]s?)\b/iu
/** Fronteiras de oração: conectores adversativos/explicativos e orações de gerúndio separam "não há causa, pois o padrão é estável" / "não apontou mudanças, mantendo a performance estável" em duas orações. */
const CLAUSE_SPLIT = /(?<=[.!?;\n])\s+|\n|,\s*(?=(?:pois|mas|por[ée]m|contudo|entretanto|todavia|j[áa]\s+que|uma\s+vez\s+que|porque|embora|apesar|enquanto|\p{L}+ndo(?:-se)?)(?!\p{L}))/iu

/** Expressões de ESTABILIDADE entre momentos afirmadas (não negadas) no texto — determinístico; vazio = nenhuma. */
export function detectStabilityLanguage(text: string): string[] {
  const found: string[] = []
  for (const clause of text.split(CLAUSE_SPLIT)) {
    for (const pattern of STABILITY_LANGUAGE) {
      const match = pattern.exec(clause)
      if (!match) continue
      // Negada na própria oração ("não permitem sustentar que houve … estabilidade") = não é afirmação de estabilidade.
      const before = clause.slice(0, match.index)
      if (NEGATION_CUE.test(before)) continue
      found.push(match[0])
    }
  }
  return [...new Set(found)]
}

/** Expressões de relação temporal de PERÍODO encontradas no texto (vazio = nenhuma). Determinístico. Inclui a família de estabilidade (V1.3.4.2). */
export function detectTemporalLanguage(text: string): string[] {
  const found: string[] = []
  for (const pattern of TEMPORAL_LANGUAGE) {
    const match = pattern.exec(text)
    if (match) found.push(match[0])
  }
  for (const sentence of text.split(/(?<=[.!?\n])\s+|\n/)) {
    if (!PERIOD_WORDS.test(sentence)) continue
    for (const pattern of TEMPORAL_LANGUAGE_CONTEXTUAL) {
      const match = pattern.exec(sentence)
      if (match) found.push(match[0])
    }
  }
  found.push(...detectStabilityLanguage(text))
  return [...new Set(found)]
}

/** Só as expressões de MUDANÇA/tendência/posição (a família de estabilidade tem autorização própria). */
export function detectChangeLanguage(text: string): string[] {
  const stability = new Set(detectStabilityLanguage(text))
  return detectTemporalLanguage(text).filter((item) => !stability.has(item))
}

/** Posição que uma expressão afirma, quando é uma expressão de POSIÇÃO ("início/fim do período"). */
export function positionClaimedBy(text: string): Exclude<RelativePosition, "SINGLE"> | null {
  if (TEMPORAL_LANGUAGE[0]!.test(text) || /\bintera[çc][õo]es\s+(?:iniciais|mais\s+antigas)\b/iu.test(text) || /\bmomentos?\s+iniciais\b/iu.test(text)) return "FIRST"
  if (TEMPORAL_LANGUAGE[1]!.test(text) || /\bintera[çc][õo]es\s+mais\s+recentes\b/iu.test(text) || /\bmomentos?\s+finais\b/iu.test(text)) return "LAST"
  if (/\bmeio\s+d[oa]\s+(?:per[ií]odo|trimestre|m[êe]s|janela)\b/iu.test(text)) return "MIDDLE"
  return null
}

// ---------------------------------------------------------------------------------------------
// Comparação temporal devolvida pela análise (validada e contada pela aplicação).
// ---------------------------------------------------------------------------------------------
/**
 * SAMPLE_DIFFERENCE_ONLY (V1.3.4.1) é status SÓ da aplicação: as amostras dos blocos diferem (presença/participação), mas
 * nenhuma relação é SUSTENTADA (ausência não estabelecida, amostra não comparável). Comparação realizada — o modelo pode
 * descrever a diferença da AMOSTRA; não pode generalizar ao período.
 */
export const TEMPORAL_COMPARISON_STATUSES = ["DIFFERENCE_OBSERVED", "SAMPLE_DIFFERENCE_ONLY", "NO_DIFFERENCE_SUPPORTED", "INSUFFICIENT_EVIDENCE"] as const
export type TemporalComparisonStatus = (typeof TEMPORAL_COMPARISON_STATUSES)[number]
export const TEMPORAL_FINDING_RELATIONS = ["INCREASED", "DECREASED", "CHANGED", "STABLE", "CONCENTRATED", "DIFFERENT_PATTERN"] as const
export type TemporalFindingRelation = (typeof TEMPORAL_FINDING_RELATIONS)[number]

/**
 * Resultado da validação de UMA relação declarada (V1.3.4.1):
 *   SUPPORTED — requisito específico da relação satisfeito (sustenta claim de período/colaborador, sujeito ao escopo);
 *   SAMPLE_DIFFERENCE_ONLY — as amostras diferem, mas o requisito não foi satisfeito (zero na amostra ≠ ausência; amostra
 *     não comparável): sustenta SÓ fato de amostra ("observado em 2 das 3 analisadas de B1 e em nenhuma das 3 de B3");
 *   INSUFFICIENT_EVIDENCE — falta base (bloco sem transcrição analisada, momento intermediário não comparado);
 *   UNSUPPORTED — as contagens contradizem a relação (direção contrária, presente em vários blocos…).
 */
export const RELATION_VALIDATION_STATUSES = ["SUPPORTED", "SAMPLE_DIFFERENCE_ONLY", "INSUFFICIENT_EVIDENCE", "UNSUPPORTED"] as const
export type RelationValidationStatus = (typeof RELATION_VALIDATION_STATUSES)[number]

/**
 * ESCOPO DE SUPORTE de uma relação temporal (V1.4.1 §26–§29) — ESCOPAMENTO, não reescrita da regra da relação:
 *   SAMPLE            — a relação vale para as AMOSTRAS comparadas ("nas analisadas, 2/3 em B1 e 3/3 em B3"); não é mudança do colaborador;
 *   RECORDED_UNIVERSE — os blocos comparados têm cobertura total do universo registrado (amostra = universo): vale para as
 *                       interações registradas do período (low-volume: descrever o universo registrado, sem traço da pessoa);
 *   EMPLOYEE_PATTERN  — além da cobertura, evidência suficiente para "o comportamento do colaborador mudou/aumentou" (≥ 4
 *                       interações com o achado nos blocos comparados e amostra ≥ 5 no conjunto comparado).
 * Uma relação SUPPORTED com +16,7 p.p. entre 3 e 2 analisadas de blocos com 10 registradas é SUPPORTED/SAMPLE — factual na
 * amostra, nunca "o colaborador passou a…".
 */
export const TEMPORAL_SUPPORT_SCOPES = ["SAMPLE", "RECORDED_UNIVERSE", "EMPLOYEE_PATTERN"] as const
export type TemporalSupportScope = (typeof TEMPORAL_SUPPORT_SCOPES)[number]
export const TEMPORAL_EMPLOYEE_MIN_MATCHED = 4
export const TEMPORAL_EMPLOYEE_MIN_ANALYZED = 5
/** Ordem de amplitude — a MESMA taxonomia do escopo de suporte de patterns (V1.4.2 `support-scope.ts`; PERIOD fica entre SAMPLE e RECORDED_UNIVERSE e não ocorre em relações temporais). */
export function supportScopeIndex(scope: TemporalSupportScope): number {
  return supportScopeRank(scope)
}
/** Escopo de suporte de uma relação SUSTENTADA a partir das contagens dos blocos comparados (determinístico). */
export function temporalSupportScopeOf(compared: BucketFindingCounts[]): TemporalSupportScope {
  if (compared.length === 0) return "SAMPLE"
  const fullCoverage = compared.every((count) => count.universeCount !== null && count.analyzedTranscriptCount >= count.universeCount)
  if (!fullCoverage) return "SAMPLE"
  const matched = compared.reduce((sum, count) => sum + count.matchedTranscriptCount, 0)
  const analyzed = compared.reduce((sum, count) => sum + count.analyzedTranscriptCount, 0)
  return matched >= TEMPORAL_EMPLOYEE_MIN_MATCHED && analyzed >= TEMPORAL_EMPLOYEE_MIN_ANALYZED ? "EMPLOYEE_PATTERN" : "RECORDED_UNIVERSE"
}

/** Amostra mínima por bloco para comparar participações (1 transcrição = 0 % ou 100 %: não é comparável). */
export const MIN_COMPARABLE_BUCKET_SAMPLE = 2
/** Regra determinística de AUSÊNCIA: zero na amostra só vira ausência no bloco com cobertura total do universo registrado, ou amostra ≥ 5 cobrindo ≥ 50 % dele. */
export const ABSENCE_MIN_ANALYZED = 5
export const ABSENCE_MIN_COVERAGE_PERCENT = 50

/** Contagens de um achado por bloco — só evidência validada; a aplicação calcula participação, cobertura e ausência. */
export type BucketFindingCounts = {
  bucketRef: string
  analyzedTranscriptCount: number
  matchedTranscriptCount: number
  verifiedExcerptCount: number
  matchedShareOfAnalyzedPercent: number | null
  /** Interações registradas do colaborador no bloco (universo); null = desconhecido. */
  universeCount: number | null
  /** analisadas / universo do bloco (%), null sem universo. */
  coveragePercent: number | null
  /** Nenhuma transcrição analisada do bloco tem trecho validado do achado (fato da AMOSTRA). */
  zeroMatchedInSample: boolean
  /** Zero na amostra + cobertura suficiente (regra acima) ⇒ ausência no bloco estabelecida. Nunca decidido pelo LLM. */
  absenceEstablished: boolean
}

export type TemporalComparisonFinding = {
  relation: TemporalFindingRelation
  /** Índice (0-based) do achado em `findings` a que a relação se refere. */
  subjectFindingIndex: number
  /** DIFFERENT_PATTERN: o achado que aparece no bloco posterior no lugar do sujeito (declarado ou derivado por código). */
  contrastFindingIndex: number | null
  earlierBucket: string
  laterBucket: string
  /** Refs de interações (I-n) que o modelo citou como base — só as analisadas nos blocos comparados sobrevivem. */
  evidenceRefs: string[]
  /** As AMOSTRAS dos dois blocos diferem (presença ou participação) — observação, não relação. */
  sampleDifference: boolean
  /** Calculado pela aplicação: a relação declarada é SUSTENTADA pelas contagens validadas (= relationValidationStatus SUPPORTED)? null = sem base. */
  directionSupported: boolean | null
  relationValidationStatus: RelationValidationStatus
  relationValidationReason: string | null
  /** INCREASED/DECREASED: evidência ORDENADA em ≥ 3 momentos quando a janela tem ≥ 3 blocos (tendência ≠ extremos diferentes). */
  trendSupported: boolean
  /** Diferença de participação (later − earlier, pontos percentuais) quando ambos os blocos têm transcrições analisadas. */
  shareDeltaPercentagePoints: number | null
  note: string | null
  /** V1.4.1: até onde a relação SUSTENTADA pode ser afirmada (SAMPLE quando não sustentada). */
  supportScope: TemporalSupportScope
}

export type TemporalComparison = {
  status: TemporalComparisonStatus
  comparedBuckets: string[]
  /** Blocos da janela com pelo menos uma transcrição analisada. */
  analyzedBuckets: string[]
  bucketCount: number
  findings: TemporalComparisonFinding[]
  /** Por achado (índice) × bloco: contagens validadas. */
  countsByFinding: BucketFindingCounts[][]
  /** Transcrições analisadas por bloco (todas, independente de achado). */
  analyzedByBucket: Record<string, number>
  /** Só a aplicação escreve aqui: por que rebaixou o status declarado pelo modelo. */
  downgradedReason: string | null
  /** V1.3.4.2: como o status declarado foi lido (EXACT | ALIAS lexical | RELATION_AS_STATUS | UNKNOWN) — telemetria, nunca promoção. */
  statusNormalization?: "EXACT" | "ALIAS" | "RELATION_AS_STATUS" | "UNKNOWN" | undefined
  declaredStatus?: string | undefined
}

export type TemporalComparisonDeclaration = {
  status: TemporalComparisonStatus
  comparedBuckets: string[]
  findings: { relation: TemporalFindingRelation; subjectFindingIndex: number; contrastFindingIndex?: number | null | undefined; earlierBucket: string; laterBucket: string; evidenceRefs: string[] }[]
}

const percent = (numerator: number, denominator: number): number | null => (denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null)

/** Regra determinística de ausência (§5-B/§6): cobertura total do bloco, ou amostra ≥ 5 cobrindo ≥ 50 % do universo do bloco. */
export function absenceEstablishedBy(analyzed: number, matched: number, universe: number | null): boolean {
  if (matched > 0 || analyzed === 0 || universe === null) return false
  if (analyzed >= universe) return true
  return analyzed >= ABSENCE_MIN_ANALYZED && (analyzed * 100) / universe >= ABSENCE_MIN_COVERAGE_PERCENT
}

/** Contagens validadas por achado × bloco (determinístico). `universeByBucket` = interações registradas por bloco (null = desconhecido). */
export function bucketCountsOf(findings: { verifiedExcerpts: { interactionRef: string }[] }[], analyzed: { interactionRef: string; bucketRef: string | null }[], buckets: TemporalBucket[], universeByBucket: Record<string, number> | null = null): { countsByFinding: BucketFindingCounts[][]; analyzedByBucket: Record<string, number> } {
  const analyzedByBucket: Record<string, number> = {}
  for (const bucket of buckets) analyzedByBucket[bucket.ref] = analyzed.filter((item) => item.bucketRef === bucket.ref).length
  const bucketOfRef = new Map(analyzed.map((item) => [item.interactionRef.toUpperCase(), item.bucketRef]))
  const countsByFinding = findings.map((finding) =>
    buckets.map((bucket) => {
      const inBucket = finding.verifiedExcerpts.filter((item) => bucketOfRef.get(item.interactionRef.toUpperCase()) === bucket.ref)
      const matched = new Set(inBucket.map((item) => item.interactionRef.toUpperCase())).size
      const analyzedCount = analyzedByBucket[bucket.ref] ?? 0
      const universe = universeByBucket && typeof universeByBucket[bucket.ref] === "number" ? Math.max(universeByBucket[bucket.ref]!, analyzedCount) : null
      return {
        bucketRef: bucket.ref,
        analyzedTranscriptCount: analyzedCount,
        matchedTranscriptCount: matched,
        verifiedExcerptCount: inBucket.length,
        matchedShareOfAnalyzedPercent: percent(matched, analyzedCount),
        universeCount: universe,
        coveragePercent: universe === null ? null : percent(analyzedCount, universe),
        zeroMatchedInSample: analyzedCount > 0 && matched === 0,
        absenceEstablished: absenceEstablishedBy(analyzedCount, matched, universe),
      }
    }),
  )
  return { countsByFinding, analyzedByBucket }
}

type RelationVerdict = { status: RelationValidationStatus; reason: string | null }
const describeZero = (count: BucketFindingCounts): string => `${count.bucketRef} 0 de ${count.analyzedTranscriptCount} analisada(s)${count.universeCount !== null ? ` (universo ${count.universeCount})` : " (universo desconhecido)"} — ausência não estabelecida`

/** Um ponto de comparação é válido quando tem evidência POSITIVA ou ausência ESTABELECIDA, com amostra comparável. */
function comparisonPointIssue(count: BucketFindingCounts): string | null {
  if (count.analyzedTranscriptCount === 0) return `${count.bucketRef} sem transcrição analisada`
  // Amostra de 1 só é comparável quando É o universo do bloco (cobertura total).
  if (count.analyzedTranscriptCount < MIN_COMPARABLE_BUCKET_SAMPLE && !(count.universeCount !== null && count.analyzedTranscriptCount >= count.universeCount)) return `${count.bucketRef} com ${count.analyzedTranscriptCount} transcrição analisada — amostra não comparável`
  if (count.matchedTranscriptCount === 0 && !count.absenceEstablished) return describeZero(count)
  return null
}

/** Requisito específico de cada relação (§4–§10 da V1.3.4.1) — determinístico, sobre as contagens validadas. */
function validateRelation(relation: TemporalFindingRelation, row: BucketFindingCounts[], earlier: BucketFindingCounts, later: BucketFindingCounts, contrast: BucketFindingCounts[] | null, bucketCount: number): RelationVerdict & { sampleDifference: boolean; trendSupported: boolean } {
  const earlierShare = earlier.matchedShareOfAnalyzedPercent ?? 0
  const laterShare = later.matchedShareOfAnalyzedPercent ?? 0
  const presentEarlier = earlier.matchedTranscriptCount > 0
  const presentLater = later.matchedTranscriptCount > 0
  const sampleDifference = presentEarlier !== presentLater || earlierShare !== laterShare
  const pairIssue = (presentEarlier || presentLater) ? (comparisonPointIssue(earlier) ?? comparisonPointIssue(later)) : "achado ausente na amostra dos dois blocos"
  const pairValid = pairIssue === null
  const noTrend = { trendSupported: false }
  switch (relation) {
    case "INCREASED":
    case "DECREASED": {
      const directionOk = relation === "INCREASED" ? laterShare > earlierShare : laterShare < earlierShare
      if (!directionOk) return { status: "UNSUPPORTED", reason: `participação ${earlier.bucketRef} ${earlierShare}% × ${later.bucketRef} ${laterShare}% não sustenta ${relation}`, sampleDifference, ...noTrend }
      if (!pairValid) return { status: "SAMPLE_DIFFERENCE_ONLY", reason: pairIssue, sampleDifference, ...noTrend }
      return { status: "SUPPORTED", reason: null, sampleDifference, trendSupported: trendSupportedBy(relation, row, earlier, later, bucketCount) }
    }
    case "CHANGED": {
      if (!sampleDifference) return { status: "UNSUPPORTED", reason: `participação ${earlier.bucketRef} ${earlierShare}% × ${later.bucketRef} ${laterShare}% — sem diferença entre as amostras`, sampleDifference, ...noTrend }
      if (!pairValid) return { status: "SAMPLE_DIFFERENCE_ONLY", reason: pairIssue, sampleDifference, ...noTrend }
      return { status: "SUPPORTED", reason: null, sampleDifference, ...noTrend }
    }
    case "STABLE": {
      // Todos os blocos do intervalo earlier..later contam (§8): um momento intermediário diferente derruba "estável".
      const range = row.filter((count) => indexOfRef(count.bucketRef) >= indexOfRef(earlier.bucketRef) && indexOfRef(count.bucketRef) <= indexOfRef(later.bucketRef))
      const missing = range.filter((count) => count.analyzedTranscriptCount === 0)
      if (bucketCount >= 3 && missing.length > 0) return { status: "INSUFFICIENT_EVIDENCE", reason: `${missing.map((count) => count.bucketRef).join(", ")} sem transcrição analisada — estabilidade exige comparar os momentos intermediários`, sampleDifference, ...noTrend }
      const absent = range.find((count) => count.analyzedTranscriptCount > 0 && count.matchedTranscriptCount === 0)
      if (absent) return absent.absenceEstablished ? { status: "UNSUPPORTED", reason: `ausência estabelecida em ${absent.bucketRef} — não é estável`, sampleDifference: true, ...noTrend } : { status: "INSUFFICIENT_EVIDENCE", reason: describeZero(absent), sampleDifference: true, ...noTrend }
      const small = range.find((count) => count.analyzedTranscriptCount < MIN_COMPARABLE_BUCKET_SAMPLE && !(count.universeCount !== null && count.analyzedTranscriptCount >= count.universeCount))
      if (small) return { status: "INSUFFICIENT_EVIDENCE", reason: `${small.bucketRef} com ${small.analyzedTranscriptCount} transcrição analisada — amostra não comparável`, sampleDifference, ...noTrend }
      return { status: "SUPPORTED", reason: null, sampleDifference, ...noTrend }
    }
    case "CONCENTRATED": {
      // Concentração é sobre a JANELA: presente em exatamente um bloco analisado e ausência ESTABELECIDA nos blocos de contraste (§9).
      const withData = row.filter((count) => count.analyzedTranscriptCount > 0)
      const present = withData.filter((count) => count.matchedTranscriptCount > 0)
      if (withData.length < 2) return { status: "INSUFFICIENT_EVIDENCE", reason: "menos de dois blocos com transcrição analisada", sampleDifference, ...noTrend }
      if (present.length !== 1) return { status: "UNSUPPORTED", reason: present.length === 0 ? "achado ausente em todas as amostras" : `achado presente em ${present.map((count) => count.bucketRef).join(", ")} — não está concentrado num bloco`, sampleDifference, ...noTrend }
      const fragile = withData.filter((count) => count.matchedTranscriptCount === 0 && !count.absenceEstablished)
      if (fragile.length > 0) return { status: "SAMPLE_DIFFERENCE_ONLY", reason: `observado só na amostra de ${present[0]!.bucketRef}; ${fragile.map(describeZero).join("; ")}`, sampleDifference: true, ...noTrend }
      return { status: "SUPPORTED", reason: null, sampleDifference: true, ...noTrend }
    }
    case "DIFFERENT_PATTERN": {
      // Padrões diferentes = achado A positivo no bloco anterior e achado B positivo no posterior — sem exigir ausência absoluta (§10).
      if (!presentEarlier) return { status: "UNSUPPORTED", reason: `achado sujeito sem evidência em ${earlier.bucketRef}`, sampleDifference, ...noTrend }
      const contrastLater = contrast?.find((count) => count.bucketRef === later.bucketRef)
      if (!contrastLater || contrastLater.matchedTranscriptCount === 0) return { status: "INSUFFICIENT_EVIDENCE", reason: `nenhum achado de contraste com evidência em ${later.bucketRef}`, sampleDifference, ...noTrend }
      return { status: "SUPPORTED", reason: null, sampleDifference: true, ...noTrend }
    }
  }
}

const indexOfRef = (ref: string): number => Number(ref.replace(/^B/i, "")) - 1

/**
 * TENDÊNCIA (§7): com ≥ 3 blocos na janela, exige ≥ 3 momentos ORDENADOS com ponto de comparação válido, cada passo no
 * sentido declarado (ou igual) e extremos diferentes — "B1 alto, B3 baixo, B2 desconhecido" não é tendência.
 */
function trendSupportedBy(relation: "INCREASED" | "DECREASED", row: BucketFindingCounts[], earlier: BucketFindingCounts, later: BucketFindingCounts, bucketCount: number): boolean {
  if (bucketCount < 3) return true
  const range = row.filter((count) => indexOfRef(count.bucketRef) >= indexOfRef(earlier.bucketRef) && indexOfRef(count.bucketRef) <= indexOfRef(later.bucketRef))
  const points = range.filter((count) => count.analyzedTranscriptCount > 0)
  if (points.length < 3 || points.some((count) => comparisonPointIssue(count) !== null && !(count.matchedTranscriptCount === 0 && count.absenceEstablished))) return false
  for (let step = 1; step < points.length; step += 1) {
    const previous = points[step - 1]!.matchedShareOfAnalyzedPercent ?? 0
    const current = points[step]!.matchedShareOfAnalyzedPercent ?? 0
    if (relation === "INCREASED" ? current < previous : current > previous) return false
  }
  return (points[0]!.matchedShareOfAnalyzedPercent ?? 0) !== (points[points.length - 1]!.matchedShareOfAnalyzedPercent ?? 0)
}

/**
 * Valida a comparação temporal DECLARADA pelo modelo contra as contagens calculadas: blocos existem e são cronológicos
 * (earlier < later), ambos com transcrição analisada, refs restritas às interações desses blocos e o REQUISITO ESPECÍFICO
 * de cada relação (validateRelation). Status só é rebaixado (DIFFERENCE_OBSERVED → SAMPLE_DIFFERENCE_ONLY →
 * INSUFFICIENT_EVIDENCE), nunca promovido; NO_DIFFERENCE_SUPPORTED é resultado válido, rebaixado só quando as contagens
 * ESTABELECEM uma diferença que ele contradiz.
 */
export function validateTemporalComparison(declaration: TemporalComparisonDeclaration | null, findingsCount: number, counts: { countsByFinding: BucketFindingCounts[][]; analyzedByBucket: Record<string, number> }, analyzed: { interactionRef: string; bucketRef: string | null }[], buckets: TemporalBucket[]): TemporalComparison {
  const bucketRefs = new Set(buckets.map((bucket) => bucket.ref))
  const indexOf = (ref: string) => buckets.find((bucket) => bucket.ref === ref.toUpperCase())?.index ?? -1
  const analyzedBuckets = buckets.filter((bucket) => (counts.analyzedByBucket[bucket.ref] ?? 0) > 0).map((bucket) => bucket.ref)
  const base = { countsByFinding: counts.countsByFinding, analyzedByBucket: counts.analyzedByBucket, analyzedBuckets, bucketCount: buckets.length }
  if (!declaration) return { status: "INSUFFICIENT_EVIDENCE", comparedBuckets: [], findings: [], ...base, downgradedReason: "a análise não declarou comparação temporal" }
  const compared = [...new Set(declaration.comparedBuckets.map((ref) => ref.trim().toUpperCase()).filter((ref) => bucketRefs.has(ref)))].sort((a, b) => indexOf(a) - indexOf(b))
  const comparedWithData = compared.filter((ref) => (counts.analyzedByBucket[ref] ?? 0) > 0)
  const findings: TemporalComparisonFinding[] = []
  const invalid = (item: TemporalComparisonDeclaration["findings"][number], earlier: string, later: string, note: string): TemporalComparisonFinding => ({ relation: item.relation, subjectFindingIndex: item.subjectFindingIndex, contrastFindingIndex: null, earlierBucket: earlier, laterBucket: later, evidenceRefs: [], sampleDifference: false, directionSupported: false, relationValidationStatus: "INSUFFICIENT_EVIDENCE", relationValidationReason: note, trendSupported: false, shareDeltaPercentagePoints: null, note, supportScope: "SAMPLE" })
  for (const item of declaration.findings) {
    const earlier = item.earlierBucket.trim().toUpperCase()
    const later = item.laterBucket.trim().toUpperCase()
    const subject = item.subjectFindingIndex
    if (!bucketRefs.has(earlier) || !bucketRefs.has(later) || indexOf(earlier) >= indexOf(later) || subject < 0 || subject >= findingsCount) {
      findings.push(invalid(item, earlier, later, "blocos inválidos (inexistentes ou fora de ordem) ou achado inexistente"))
      continue
    }
    const allowedRefs = new Set(analyzed.filter((entry) => entry.bucketRef === earlier || entry.bucketRef === later).map((entry) => entry.interactionRef.toUpperCase()))
    const refs = [...new Set(item.evidenceRefs.map((ref) => ref.trim().toUpperCase()))].filter((ref) => allowedRefs.has(ref))
    const row = counts.countsByFinding[subject] ?? []
    const earlierCounts = row.find((count) => count.bucketRef === earlier)
    const laterCounts = row.find((count) => count.bucketRef === later)
    if (!earlierCounts || !laterCounts || earlierCounts.analyzedTranscriptCount === 0 || laterCounts.analyzedTranscriptCount === 0) {
      const note = "um dos blocos comparados não tem transcrição analisada — sem base para a relação"
      findings.push({ ...invalid(item, earlier, later, note), evidenceRefs: refs, directionSupported: null })
      continue
    }
    // DIFFERENT_PATTERN: contraste declarado ou derivado (primeiro OUTRO achado com evidência no bloco posterior).
    let contrastIndex: number | null = typeof item.contrastFindingIndex === "number" && item.contrastFindingIndex >= 0 && item.contrastFindingIndex < findingsCount && item.contrastFindingIndex !== subject ? item.contrastFindingIndex : null
    if (item.relation === "DIFFERENT_PATTERN" && contrastIndex === null) contrastIndex = counts.countsByFinding.findIndex((other, index) => index !== subject && (other.find((count) => count.bucketRef === later)?.matchedTranscriptCount ?? 0) > 0)
    const contrast = contrastIndex !== null && contrastIndex >= 0 ? counts.countsByFinding[contrastIndex] ?? null : null
    const verdict = validateRelation(item.relation, row, earlierCounts, laterCounts, contrast, buckets.length)
    const delta = Math.round(((laterCounts.matchedShareOfAnalyzedPercent ?? 0) - (earlierCounts.matchedShareOfAnalyzedPercent ?? 0)) * 10) / 10
    findings.push({
      relation: item.relation,
      subjectFindingIndex: subject,
      contrastFindingIndex: item.relation === "DIFFERENT_PATTERN" && contrastIndex !== null && contrastIndex >= 0 ? contrastIndex : null,
      earlierBucket: earlier,
      laterBucket: later,
      evidenceRefs: refs,
      sampleDifference: verdict.sampleDifference,
      directionSupported: verdict.status === "SUPPORTED",
      relationValidationStatus: verdict.status,
      relationValidationReason: verdict.reason,
      trendSupported: verdict.trendSupported,
      shareDeltaPercentagePoints: delta,
      note: verdict.status === "SUPPORTED" ? null : `${verdict.status}: ${verdict.reason}`,
      // V1.4.1: escopo de suporte — STABLE considera todos os blocos do intervalo; as demais, os dois comparados.
      supportScope: verdict.status === "SUPPORTED" ? temporalSupportScopeOf(item.relation === "STABLE" ? row.filter((count) => indexOf(count.bucketRef) >= indexOf(earlier) && indexOf(count.bucketRef) <= indexOf(later)) : [earlierCounts, laterCounts]) : "SAMPLE",
    })
  }
  let status: TemporalComparisonStatus = declaration.status
  let downgradedReason: string | null = null
  const supported = findings.some((finding) => finding.relationValidationStatus === "SUPPORTED")
  const sampleOnly = findings.some((finding) => finding.relationValidationStatus === "SAMPLE_DIFFERENCE_ONLY")
  if (comparedWithData.length < 2) {
    status = "INSUFFICIENT_EVIDENCE"
    downgradedReason = "menos de dois blocos comparados com transcrição analisada"
  } else if (status === "DIFFERENCE_OBSERVED" && !supported) {
    status = sampleOnly ? "SAMPLE_DIFFERENCE_ONLY" : "INSUFFICIENT_EVIDENCE"
    downgradedReason = findings.length === 0 ? "diferença declarada sem nenhuma relação estruturada" : sampleOnly ? "as amostras diferem, mas nenhuma relação declarada é SUSTENTADA (zero na amostra não é ausência no bloco; amostra não comparável)" : "nenhuma relação declarada é sustentada pelas contagens validadas"
  } else if (status === "SAMPLE_DIFFERENCE_ONLY" && !supported && !sampleOnly && findings.length > 0) {
    status = "INSUFFICIENT_EVIDENCE"
    downgradedReason = "nenhuma diferença entre as amostras dos blocos comparados"
  } else if (status === "NO_DIFFERENCE_SUPPORTED") {
    // Contradição ESTABELECIDA (não ruído de amostra): achado presente num bloco comparado e ausência estabelecida noutro.
    const contradiction = counts.countsByFinding.map((row, index) => ({ index, present: row.filter((count) => comparedWithData.includes(count.bucketRef) && count.matchedTranscriptCount > 0), absent: row.filter((count) => comparedWithData.includes(count.bucketRef) && count.absenceEstablished) })).find((item) => item.present.length > 0 && item.absent.length > 0)
    if (contradiction) {
      status = "INSUFFICIENT_EVIDENCE"
      downgradedReason = `achado ${contradiction.index + 1} presente em ${contradiction.present.map((count) => count.bucketRef).join(", ")} com ausência estabelecida em ${contradiction.absent.map((count) => count.bucketRef).join(", ")} — "nenhuma diferença" não se sustenta`
    }
  }
  return { status, comparedBuckets: comparedWithData, findings, ...base, downgradedReason }
}

// ---------------------------------------------------------------------------------------------
// Fatos temporais no ledger (o que a síntese pode usar para sustentar uma relação temporal).
// ---------------------------------------------------------------------------------------------
export type TemporalComparisonSignalFinding = { relation: TemporalFindingRelation; earlierBucket: string; laterBucket: string; directionSupported: boolean | null; relationValidationStatus?: RelationValidationStatus | undefined; relationValidationReason?: string | null | undefined; sampleDifference?: boolean | undefined; trendSupported?: boolean | undefined; /** V1.4.1: escopo de suporte da relação (ausente em runs anteriores = SAMPLE). */ supportScope?: TemporalSupportScope | undefined }
export type TemporalComparisonSignal = { status: TemporalComparisonStatus; comparedBuckets: string[]; behavioral: boolean; findings: TemporalComparisonSignalFinding[]; analyzedBuckets?: string[] | undefined; bucketCount?: number | undefined; /** V1.3.4.1: alguma ausência achado × bloco estabelecida pela regra de cobertura. */ absenceEstablished?: boolean | undefined }

/** Tools de INDICADOR que comparam momentos (tendência do número — nunca prova de mudança comportamental). */
export const INDICATOR_TEMPORAL_TOOLS = ["get_employee_history", "compare_periods", "detect_anomalies"] as const

export type TemporalFact = { ref: string; behavioral: boolean; signal: TemporalComparisonSignal | null }

/** Fatos do ledger que COMPARAM momentos: análise de interações com comparação temporal (comportamental; SAMPLE_DIFFERENCE_ONLY conta como comparação realizada) e histórico/compare de indicador. */
export function temporalFactsOf(ledger: LedgerEntry[]): TemporalFact[] {
  const facts: TemporalFact[] = []
  for (const entry of ledger) {
    if (entry.qualityStatus === "NO_DATA" || entry.qualityStatus === "NOT_SUPPORTED") continue
    const signal = entry.signals?.temporalComparison ?? null
    if (signal && signal.status !== "INSUFFICIENT_EVIDENCE") facts.push({ ref: entry.ref, behavioral: signal.behavioral, signal })
    else if ((INDICATOR_TEMPORAL_TOOLS as readonly string[]).includes(entry.tool)) facts.push({ ref: entry.ref, behavioral: false, signal: null })
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// Gating de claims temporais (aplicado por código na síntese; sem LLM juiz).
// ---------------------------------------------------------------------------------------------
export const TEMPORAL_REJECTION_REASONS = ["TEMPORAL_RELATION_UNDECLARED", "INSUFFICIENT_BUCKETS", "WRONG_TEMPORAL_POSITION", "NO_COMPARATIVE_EVIDENCE", "UNSUPPORTED_DIRECTION", "SAMPLE_DIFFERENCE_ONLY", "INSUFFICIENT_REPRESENTATIVENESS", "TEMPORAL_CONCLUSION_INCOMPATIBLE", "TEMPORAL_SUPPORT_SCOPE"] as const
export type TemporalRejectionReason = (typeof TEMPORAL_REJECTION_REASONS)[number]

export type TemporalGatingInput = {
  text: string
  metadata: TemporalClaimMetadata
  evidenceRefs: string[]
  scope: ClaimScope
  /** A claim é comportamental (behavioralClaims)? Então a comparação precisa ser comportamental (§24). */
  behavioral: boolean
  /** Representatividade da evidência referenciada é suficiente para o escopo (regra existente)? */
  scopeSupported: boolean
}

export type TemporalGatingContext = { buckets: TemporalBucket[]; facts: TemporalFact[] }

export type TemporalVerdict = { temporal: boolean; ok: boolean; reason: TemporalRejectionReason | null; detail: string | null }

const SUPPORTED_STATUS = (finding: TemporalComparisonSignalFinding): boolean => finding.relationValidationStatus ? finding.relationValidationStatus === "SUPPORTED" : finding.directionSupported === true
const SAMPLE_ONLY_STATUS = (finding: TemporalComparisonSignalFinding): boolean => finding.relationValidationStatus === "SAMPLE_DIFFERENCE_ONLY" || (finding.sampleDifference === true && !SUPPORTED_STATUS(finding))
const CHANGE_RELATIONS: readonly TemporalFindingRelation[] = ["INCREASED", "DECREASED", "CHANGED", "CONCENTRATED", "DIFFERENT_PATTERN"]

/**
 * Uma claim temporal precisa de: relação declarada (metadata), ≥ 2 blocos válidos (ou posição coerente com o bloco),
 * fato comparativo no ledger que cubra esses blocos (comportamental quando a claim é comportamental), o REQUISITO
 * ESPECÍFICO da relação (V1.3.4.1: mudança sustentada ≠ diferença de amostra; tendência = ≥ 3 momentos ordenados;
 * estabilidade = todos os momentos analisados comparados; concentração = ausência estabelecida nos contrastes) e
 * representatividade para o escopo. Fato de AMOSTRA ("apareceu em 2 das 3 analisadas de B1 e em nenhuma das 3 de B3")
 * é aceito só com escopo INTERACTION_SPECIFIC e sem linguagem de relação de período (§15).
 * Claim sem relação declarada mas com linguagem temporal de período = TEMPORAL_RELATION_UNDECLARED.
 */
export function gateTemporalClaim(input: TemporalGatingInput, context: TemporalGatingContext): TemporalVerdict {
  const relation = input.metadata.temporalRelation ?? "NONE"
  const language = detectTemporalLanguage(input.text)
  if (relation === "NONE") {
    if (language.length === 0) return { temporal: false, ok: true, reason: null, detail: null }
    return { temporal: true, ok: false, reason: "TEMPORAL_RELATION_UNDECLARED", detail: `linguagem de relação temporal ("${language[0]}") sem temporalRelation/evidenceBuckets declarados` }
  }
  const bucketByRef = new Map(context.buckets.map((bucket) => [bucket.ref, bucket]))
  const buckets = [...new Set((input.metadata.evidenceBuckets ?? []).map((ref) => ref.trim().toUpperCase()))].map((ref) => bucketByRef.get(ref)).filter((bucket): bucket is TemporalBucket => Boolean(bucket))
  const bucketRefs = buckets.map((bucket) => bucket.ref)
  if (relation === "POSITION") {
    const claimed = input.metadata.position ?? positionClaimedBy(input.text)
    if (!claimed || buckets.length === 0) return { temporal: true, ok: false, reason: "INSUFFICIENT_BUCKETS", detail: "posição no período sem bloco de evidência declarado" }
    if (context.buckets.length <= 1) return { temporal: true, ok: false, reason: "INSUFFICIENT_BUCKETS", detail: "a janela tem um único bloco — não existe início/meio/fim" }
    const wrong = buckets.filter((bucket) => bucket.relativePosition !== claimed)
    if (wrong.length > 0) return { temporal: true, ok: false, reason: "WRONG_TEMPORAL_POSITION", detail: `afirma ${claimed} mas a evidência está em ${wrong.map((bucket) => `${bucket.ref} (${bucket.relativePosition})`).join(", ")}` }
    return { temporal: true, ok: true, reason: null, detail: null }
  }
  if (buckets.length < 2) return { temporal: true, ok: false, reason: "INSUFFICIENT_BUCKETS", detail: `relação ${relation} exige evidência de pelo menos dois blocos (declarados: ${bucketRefs.join(", ") || "nenhum"})` }
  const windowCount = context.buckets.length
  if (relation === "TREND" && windowCount >= 3 && buckets.length < 3) return { temporal: true, ok: false, reason: "INSUFFICIENT_BUCKETS", detail: `tendência exige evidência ordenada em pelo menos 3 momentos quando a janela tem ${windowCount} blocos (declarados: ${bucketRefs.join(", ")}) — extremos diferentes não são tendência` }
  const refs = new Set(input.evidenceRefs.map((ref) => ref.trim().toUpperCase()))
  const facts = context.facts.filter((fact) => refs.has(fact.ref) && (!input.behavioral || fact.behavioral))
  if (facts.length === 0) {
    const indicatorOnly = context.facts.some((fact) => refs.has(fact.ref) && !fact.behavioral)
    return { temporal: true, ok: false, reason: "NO_COMPARATIVE_EVIDENCE", detail: indicatorOnly && input.behavioral ? "só há comparação de INDICADOR entre os refs — tendência do número não prova mudança de comportamento" : "nenhum fato do ledger compara os momentos citados" }
  }
  const covering = facts.filter((fact) => fact.signal === null || bucketRefs.every((ref) => fact.signal!.comparedBuckets.includes(ref)))
  if (covering.length === 0) return { temporal: true, ok: false, reason: "NO_COMPARATIVE_EVIDENCE", detail: `o fato comparativo não cobre os blocos ${bucketRefs.join(", ")}` }
  const signals = covering.map((fact) => fact.signal).filter((signal): signal is TemporalComparisonSignal => signal !== null)
  if (signals.length > 0) {
    // Relações declaradas pela análise cujos blocos estão entre os que a claim cita.
    const relevant = signals.flatMap((signal) => signal.findings.filter((finding) => bucketRefs.includes(finding.earlierBucket.toUpperCase()) && bucketRefs.includes(finding.laterBucket.toUpperCase())))
    const supportedChange = relevant.filter((finding) => CHANGE_RELATIONS.includes(finding.relation) && SUPPORTED_STATUS(finding))
    const sampleOnlyChange = relevant.filter((finding) => CHANGE_RELATIONS.includes(finding.relation) && SAMPLE_ONLY_STATUS(finding))
    const anySupportedDifference = signals.some((signal) => signal.findings.some((finding) => CHANGE_RELATIONS.includes(finding.relation) && SUPPORTED_STATUS(finding)))
    const noDifference = signals.every((signal) => signal.status === "NO_DIFFERENCE_SUPPORTED")
    const sampleLevelAllowed = input.scope === "INTERACTION_SPECIFIC" && language.length === 0
    const sampleOnlyVerdict = (what: string): TemporalVerdict => ({ temporal: true, ok: false, reason: "SAMPLE_DIFFERENCE_ONLY", detail: `${what}: ${sampleOnlyChange[0]?.relationValidationReason ?? "as amostras diferem, mas a ausência num bloco não foi estabelecida"} — descreva só o fato da amostra ("observado em N das M analisadas de B1 e em nenhuma das K de B3"), com escopo INTERACTION_SPECIFIC` })
    if (relation === "EARLIER_VS_LATER" || relation === "CHANGE") {
      if (supportedChange.length === 0) {
        if (sampleOnlyChange.length > 0) return sampleLevelAllowed ? { temporal: true, ok: true, reason: null, detail: null } : sampleOnlyVerdict(relation === "CHANGE" ? "mudança não sustentada" : "diferença só na amostra")
        if (noDifference || relevant.length > 0 || signals.every((signal) => signal.status !== "DIFFERENCE_OBSERVED")) return { temporal: true, ok: false, reason: "UNSUPPORTED_DIRECTION", detail: noDifference ? "a comparação validada não sustentou diferença entre os blocos" : `nenhuma relação sustentada entre ${bucketRefs.join(" e ")}${relevant[0]?.relationValidationReason ? ` (${relevant[0].relationValidationReason})` : ""}` }
        return { temporal: true, ok: false, reason: "NO_COMPARATIVE_EVIDENCE", detail: `a comparação validada não tem relação sustentada entre os blocos ${bucketRefs.join(", ")}` }
      }
    } else if (relation === "TREND") {
      const trend = relevant.filter((finding) => (finding.relation === "INCREASED" || finding.relation === "DECREASED") && SUPPORTED_STATUS(finding) && (windowCount < 3 || finding.trendSupported === true))
      if (trend.length === 0) {
        if (noDifference) return { temporal: true, ok: false, reason: "UNSUPPORTED_DIRECTION", detail: "a comparação validada não sustentou diferença entre os blocos" }
        if (sampleOnlyChange.length > 0 && supportedChange.length === 0) return sampleOnlyVerdict("tendência não sustentada")
        const pair = relevant.find((finding) => (finding.relation === "INCREASED" || finding.relation === "DECREASED") && SUPPORTED_STATUS(finding))
        return { temporal: true, ok: false, reason: pair ? "INSUFFICIENT_BUCKETS" : "UNSUPPORTED_DIRECTION", detail: pair ? `${pair.relation} ${pair.earlierBucket}→${pair.laterBucket} sustentado só nos extremos — tendência exige momentos intermediários analisados e ordenados no mesmo sentido` : "nenhuma relação INCREASED/DECREASED sustentada entre os blocos citados" }
      }
    } else if (relation === "STABILITY") {
      // Estabilidade sobre o período considera TODOS os blocos analisados (§8/§14): B1 ≈ B3 com B2 fora não basta.
      const analyzedBuckets = [...new Set(signals.flatMap((signal) => signal.analyzedBuckets ?? signal.comparedBuckets))]
      const required = windowCount >= 3 ? analyzedBuckets : bucketRefs
      const missing = required.filter((ref) => !bucketRefs.includes(ref) || !signals.some((signal) => signal.comparedBuckets.includes(ref)))
      if (windowCount >= 3 && (analyzedBuckets.length < 3 || missing.length > 0)) return { temporal: true, ok: false, reason: "INSUFFICIENT_BUCKETS", detail: analyzedBuckets.length < 3 ? `estabilidade ao longo da janela exige pelo menos 3 momentos analisados (analisados: ${analyzedBuckets.join(", ") || "nenhum"})` : `bloco(s) analisado(s) ${missing.join(", ")} não entraram na comparação/claim — estabilidade exige todos os momentos relevantes` }
      const stableSupported = relevant.some((finding) => finding.relation === "STABLE" && SUPPORTED_STATUS(finding))
      if (anySupportedDifference && !stableSupported) return { temporal: true, ok: false, reason: "UNSUPPORTED_DIRECTION", detail: "a comparação validada observou diferença sustentada; 'estável' não é sustentado" }
      // V1.3.4.2 (§4/§11): "nenhuma diferença sustentada" NÃO é estabilidade — STABILITY exige relação STABLE SUSTENTADA pela regra
      // específica (presença comparável em todos os momentos do intervalo). NO_DIFFERENCE autoriza só a formulação segura.
      if (!stableSupported && noDifference) return { temporal: true, ok: false, reason: "TEMPORAL_CONCLUSION_INCOMPATIBLE", detail: `a comparação não encontrou diferença sustentada, mas nenhuma relação STABLE foi SUSTENTADA — "${TEMPORAL_SAFE_MEANINGS.NO_DIFFERENCE_SUPPORTED}" não é "permaneceu estável"` }
      if (!stableSupported) return { temporal: true, ok: false, reason: "SAMPLE_DIFFERENCE_ONLY", detail: "as amostras dos blocos diferem e nenhuma relação STABLE foi sustentada — estabilidade não estabelecida" }
    } else if (relation === "TEMPORAL_CONCENTRATION") {
      const concentrated = relevant.filter((finding) => finding.relation === "CONCENTRATED" && SUPPORTED_STATUS(finding))
      if (concentrated.length === 0) {
        const sampleOnly = relevant.filter((finding) => finding.relation === "CONCENTRATED" && SAMPLE_ONLY_STATUS(finding))
        if (sampleOnly.length > 0) return sampleLevelAllowed ? { temporal: true, ok: true, reason: null, detail: null } : { temporal: true, ok: false, reason: "SAMPLE_DIFFERENCE_ONLY", detail: `concentração não sustentada: ${sampleOnly[0]!.relationValidationReason ?? "ausência não estabelecida nos blocos de contraste"} — só "observado apenas na amostra analisada de B-n" (INTERACTION_SPECIFIC)` }
        return { temporal: true, ok: false, reason: "UNSUPPORTED_DIRECTION", detail: noDifference ? "a comparação validada não sustentou diferença entre os blocos" : "nenhuma relação CONCENTRATED sustentada pela comparação validada" }
      }
    }
  }
  if (!input.scopeSupported) return { temporal: true, ok: false, reason: "INSUFFICIENT_REPRESENTATIVENESS", detail: `relação temporal com escopo ${input.scope} exige amostra representativa` }
  // V1.4.1 (§26–§29) — ESCOPO DE SUPORTE da relação sustentada: EMPLOYEE_PATTERN exige EMPLOYEE_PATTERN; PERIOD_PATTERN exige
  // ≥ RECORDED_UNIVERSE; INTERACTION_SPECIFIC aceita SAMPLE só como fato de amostra (sem linguagem de relação de período).
  if (signals.length > 0 && relation !== "STABILITY") {
    const relevantSupported = signals.flatMap((signal) => signal.findings.filter((finding) => bucketRefs.includes(finding.earlierBucket.toUpperCase()) && bucketRefs.includes(finding.laterBucket.toUpperCase()) && SUPPORTED_STATUS(finding)))
    if (relevantSupported.length > 0) {
      const best = relevantSupported.reduce<TemporalSupportScope>((acc, finding) => (supportScopeIndex(finding.supportScope ?? "SAMPLE") > supportScopeIndex(acc) ? (finding.supportScope ?? "SAMPLE") : acc), "SAMPLE")
      const required: TemporalSupportScope | null = input.scope === "EMPLOYEE_PATTERN" || input.scope === "POPULATION_PATTERN" ? "EMPLOYEE_PATTERN" : input.scope === "PERIOD_PATTERN" ? "RECORDED_UNIVERSE" : null
      if (required && supportScopeIndex(best) < supportScopeIndex(required)) return { temporal: true, ok: false, reason: "TEMPORAL_SUPPORT_SCOPE", detail: `a relação sustentada vale só para ${best === "SAMPLE" ? "as AMOSTRAS comparadas" : "as interações REGISTRADAS do período"} (escopo de suporte ${best}) — escopo ${input.scope} exige ${required}; descreva o fato ${best === "SAMPLE" ? 'da amostra ("nas interações analisadas, N de M em B1 e K de L em B3")' : "do universo registrado"} sem afirmar mudança do colaborador` }
      if (best === "SAMPLE" && language.length > 0) return { temporal: true, ok: false, reason: "TEMPORAL_SUPPORT_SCOPE", detail: `a relação sustentada vale só para as AMOSTRAS comparadas (escopo de suporte SAMPLE) — a linguagem de relação de período ("${language[0]}") afirma mudança do colaborador; descreva o fato da amostra` }
    }
  }
  return { temporal: true, ok: true, reason: null, detail: null }
}

/** Telemetria da semântica temporal (por execução) — contagens, nunca texto. */
export type TemporalTelemetry = {
  temporalComparisonRequired: boolean
  temporalComparisonStatus: TemporalComparisonStatus | "NOT_REQUIRED" | "NOT_PERFORMED"
  availableBuckets: number
  analyzedBuckets: number
  comparedBuckets: string[]
  temporalClaimsProposed: number
  temporalClaimsAccepted: number
  temporalClaimsRejected: number
  rejectionReasons: Record<TemporalRejectionReason, number>
  /** V1.3.4.1: alguma comparação comportamental observou diferença entre AMOSTRAS (sustentada ou não). */
  sampleDifferenceDetected: boolean
  /** V1.3.4.1: alguma ausência de achado num bloco foi ESTABELECIDA pela regra de cobertura. */
  absenceEstablished: boolean
  /** Blocos da janela (datas locais + posição) — base do gating de claims temporais na síntese e do QA Lab. */
  buckets: TemporalBucket[]
  /** V1.3.4.2: conclusão temporal AUTORIZADA (derivada por código das comparações validadas) — o que o texto pode afirmar. */
  conclusion?: TemporalConclusion | undefined
}

export function emptyTemporalTelemetry(required: boolean, availableBuckets: number): TemporalTelemetry {
  return { temporalComparisonRequired: required, temporalComparisonStatus: required ? "NOT_PERFORMED" : "NOT_REQUIRED", availableBuckets, analyzedBuckets: 0, comparedBuckets: [], temporalClaimsProposed: 0, temporalClaimsAccepted: 0, temporalClaimsRejected: 0, rejectionReasons: { TEMPORAL_RELATION_UNDECLARED: 0, INSUFFICIENT_BUCKETS: 0, WRONG_TEMPORAL_POSITION: 0, NO_COMPARATIVE_EVIDENCE: 0, UNSUPPORTED_DIRECTION: 0, SAMPLE_DIFFERENCE_ONLY: 0, INSUFFICIENT_REPRESENTATIVENESS: 0, TEMPORAL_CONCLUSION_INCOMPATIBLE: 0, TEMPORAL_SUPPORT_SCOPE: 0 }, sampleDifferenceDetected: false, absenceEstablished: false, buckets: [] }
}

/** Status consolidado da execução a partir das comparações comportamentais do ledger: o mais forte sustentado vence; SAMPLE_DIFFERENCE_ONLY nunca vira "diferença". */
export function consolidatedTemporalStatus(signals: TemporalComparisonSignal[]): TemporalComparisonStatus | null {
  if (signals.some((signal) => signal.status === "DIFFERENCE_OBSERVED")) return "DIFFERENCE_OBSERVED"
  if (signals.some((signal) => signal.status === "NO_DIFFERENCE_SUPPORTED")) return "NO_DIFFERENCE_SUPPORTED"
  if (signals.some((signal) => signal.status === "SAMPLE_DIFFERENCE_ONLY")) return "SAMPLE_DIFFERENCE_ONLY"
  if (signals.length > 0) return "INSUFFICIENT_EVIDENCE"
  return null
}

// ---------------------------------------------------------------------------------------------
// CONCLUSÃO TEMPORAL AUTORIZADA (V1.3.4.2 — Temporal Conclusion Contract).
// ---------------------------------------------------------------------------------------------
/**
 * O que a investigação PODE concluir sobre o tempo, derivado por código das comparações comportamentais validadas:
 *   SUPPORTED_RELATION     — ao menos uma relação (INCREASED/DECREASED/CHANGED/STABLE/CONCENTRATED/DIFFERENT_PATTERN) SUSTENTADA;
 *   NO_DIFFERENCE_SUPPORTED — comparou e não encontrou diferença sustentada (NÃO é "estabilidade comprovada");
 *   SAMPLE_DIFFERENCE_ONLY — as amostras diferem, nada sustentado (não generaliza ao período);
 *   INSUFFICIENT_EVIDENCE  — comparou, sem base para concluir relação;
 *   NOT_COMPARED           — nenhuma comparação comportamental nesta execução.
 * `safeMeaning` é a formulação segura que o runtime disponibiliza à síntese; `allowedRelations` são as relações que uma
 * claim/texto pode afirmar (mapeadas das relações sustentadas). Nunca promove: NO_DIFFERENCE não autoriza STABILITY.
 */
export const TEMPORAL_CONCLUSION_KINDS = ["SUPPORTED_RELATION", "NO_DIFFERENCE_SUPPORTED", "SAMPLE_DIFFERENCE_ONLY", "INSUFFICIENT_EVIDENCE", "NOT_COMPARED"] as const
export type TemporalConclusionKind = (typeof TEMPORAL_CONCLUSION_KINDS)[number]
export type SupportedTemporalRelation = { ref: string; relation: TemporalFindingRelation; earlierBucket: string; laterBucket: string; trendSupported: boolean; /** V1.4.1: escopo de suporte da relação. */ supportScope: TemporalSupportScope }
export type TemporalConclusion = {
  kind: TemporalConclusionKind
  /** Formulação SEGURA (o que pode ser dito sem promover a conclusão). */
  safeMeaning: string
  /** Relações sustentadas pela comparação validada (vazio fora de SUPPORTED_RELATION). */
  supportedRelations: SupportedTemporalRelation[]
  /** Relações de claim que o texto pode afirmar (derivadas das sustentadas; NONE sempre permitido). */
  allowedRelations: Exclude<TemporalRelation, "NONE" | "POSITION">[]
  /** Refs do ledger (F-n) das comparações comportamentais consideradas. */
  refs: string[]
  /** V1.4.1: maior escopo de suporte entre as relações sustentadas (SAMPLE quando nenhuma) — o texto só afirma mudança do colaborador com EMPLOYEE_PATTERN. */
  supportScope: TemporalSupportScope
}

export const TEMPORAL_SAFE_MEANINGS: Record<TemporalConclusionKind, string> = {
  SUPPORTED_RELATION: "A comparação entre os momentos analisados sustenta a(s) relação(ões) temporal(is) listada(s) — só elas podem ser afirmadas.",
  NO_DIFFERENCE_SUPPORTED: "Não foi encontrada diferença temporal sustentada nas evidências analisadas.",
  SAMPLE_DIFFERENCE_ONLY: "Foi observada diferença entre as amostras analisadas, sem evidência suficiente para generalizar ao período.",
  INSUFFICIENT_EVIDENCE: "Os dados analisados não permitem concluir uma relação temporal.",
  NOT_COMPARED: "Os momentos do período não foram comparados — nenhuma relação temporal (mudança, tendência, estabilidade, posição) pode ser afirmada.",
}

/** Relações de claim autorizadas por uma relação SUSTENTADA da análise. */
export function claimRelationsAllowedBy(finding: SupportedTemporalRelation): Exclude<TemporalRelation, "NONE" | "POSITION">[] {
  switch (finding.relation) {
    case "STABLE":
      return ["STABILITY"]
    case "INCREASED":
    case "DECREASED":
      return finding.trendSupported ? ["TREND", "CHANGE", "EARLIER_VS_LATER"] : ["CHANGE", "EARLIER_VS_LATER"]
    case "CHANGED":
    case "DIFFERENT_PATTERN":
      return ["CHANGE", "EARLIER_VS_LATER"]
    case "CONCENTRATED":
      return ["TEMPORAL_CONCENTRATION"]
  }
}

/** Conclusão temporal autorizada a partir dos fatos comparativos COMPORTAMENTAIS do ledger (determinístico). */
export function temporalConclusionOf(facts: TemporalFact[]): TemporalConclusion {
  const behavioral = facts.filter((fact) => fact.behavioral && fact.signal !== null)
  const refs = behavioral.map((fact) => fact.ref)
  // Consistente com temporalFactsOf/gateTemporalClaim: uma relação só "sustenta" quando a COMPARAÇÃO em que nasceu é válida
  // (status ≠ INSUFFICIENT_EVIDENCE). Uma relação SUPPORTED dentro de uma comparação rebaixada (ex.: NO_DIFFERENCE declarado
  // e contradito por ausência estabelecida noutro achado) NÃO é promovida — a comparação precisa ser refeita/declarada certa.
  const supportedRelations: SupportedTemporalRelation[] = behavioral.filter((fact) => fact.signal!.status !== "INSUFFICIENT_EVIDENCE").flatMap((fact) =>
    fact.signal!.findings.filter((finding) => (finding.relationValidationStatus ? finding.relationValidationStatus === "SUPPORTED" : finding.directionSupported === true)).map((finding) => ({ ref: fact.ref, relation: finding.relation, earlierBucket: finding.earlierBucket, laterBucket: finding.laterBucket, trendSupported: finding.trendSupported === true, supportScope: finding.supportScope ?? "SAMPLE" })),
  )
  const supportScope = supportedRelations.reduce<TemporalSupportScope>((acc, item) => (supportScopeIndex(item.supportScope) > supportScopeIndex(acc) ? item.supportScope : acc), "SAMPLE")
  const build = (kind: TemporalConclusionKind): TemporalConclusion => ({ kind, safeMeaning: TEMPORAL_SAFE_MEANINGS[kind], supportedRelations, allowedRelations: [...new Set(supportedRelations.flatMap(claimRelationsAllowedBy))], refs, supportScope })
  if (supportedRelations.length > 0) return build("SUPPORTED_RELATION")
  if (behavioral.length === 0) return build("NOT_COMPARED")
  const statuses = behavioral.map((fact) => fact.signal!.status)
  if (statuses.includes("NO_DIFFERENCE_SUPPORTED")) return build("NO_DIFFERENCE_SUPPORTED")
  if (statuses.includes("SAMPLE_DIFFERENCE_ONLY")) return build("SAMPLE_DIFFERENCE_ONLY")
  return build("INSUFFICIENT_EVIDENCE")
}

/** Conclusão temporal a partir do ledger inteiro (atalho: fatos temporais → conclusão). */
export function temporalConclusionOfLedger(ledger: LedgerEntry[]): TemporalConclusion {
  // INSUFFICIENT_EVIDENCE não entra em temporalFactsOf (não satisfaz a necessidade), mas conta como "comparou" para a conclusão.
  const facts = temporalFactsOf(ledger)
  const insufficient = ledger.filter((entry) => entry.signals?.temporalComparison?.status === "INSUFFICIENT_EVIDENCE" && !facts.some((fact) => fact.ref === entry.ref)).map((entry) => ({ ref: entry.ref, behavioral: true, signal: entry.signals!.temporalComparison! }))
  return temporalConclusionOf([...facts, ...insufficient])
}

/** Bloco model-facing da conclusão autorizada (dossiê/síntese): o que pode ser dito — nunca o que o modelo gostaria de dizer. */
export function renderTemporalConclusion(conclusion: TemporalConclusion): string {
  const scopeNote = conclusion.supportedRelations.length > 0 ? conclusion.supportScope === "SAMPLE" ? ' Escopo de suporte SAMPLE: a relação vale só para as AMOSTRAS comparadas — escreva o fato da amostra ("nas interações analisadas, N de M em B1 e K de L em B3"), nunca "o colaborador passou a/aumentou/mudou".' : conclusion.supportScope === "RECORDED_UNIVERSE" ? " Escopo de suporte RECORDED_UNIVERSE: vale para as interações registradas do período (cobertura total) — descreva o universo registrado, sem traço do colaborador." : " Escopo de suporte EMPLOYEE_PATTERN: pode ser afirmada como mudança do colaborador." : ""
  const relations = conclusion.supportedRelations.length > 0 ? ` Relações sustentadas: ${conclusion.supportedRelations.map((item) => `${item.relation} ${item.earlierBucket}→${item.laterBucket}${item.trendSupported ? " (tendência)" : ""} [${item.supportScope}] (${item.ref})`).join("; ")}. Claims temporais permitidas: ${conclusion.allowedRelations.join(", ")}.${scopeNote}` : ""
  const forbidden = conclusion.kind === "NO_DIFFERENCE_SUPPORTED" ? ' Isso NÃO é "permaneceu estável"/"se manteve constante" (estabilidade exige relação STABLE sustentada) — use a formulação segura.' : conclusion.kind === "SAMPLE_DIFFERENCE_ONLY" ? " Não afirme mudança, queda, aumento ou ausência no período — só o fato da amostra." : conclusion.kind === "SUPPORTED_RELATION" ? "" : " Não afirme mudança, tendência, estabilidade, concentração ou posição no período."
  return `CONCLUSÃO TEMPORAL AUTORIZADA (${conclusion.kind}): ${conclusion.safeMeaning}${relations}${forbidden}`
}

export type TemporalSurface = { where: string; text: string }
export type TemporalAuthorization = {
  conclusion: TemporalConclusion
  /** Relações temporais de claims ACEITAS pelo gating nesta resposta. */
  acceptedRelations: TemporalRelation[]
  /** Existe fato de INDICADOR que compara momentos (histórico/compare/anomalias) — linguagem de evolução do NÚMERO permitida (V1.3.4). */
  indicatorTemporalFact: boolean
  /** Fato de indicador com sinal STABLE — "o indicador se manteve estável" permitido. */
  indicatorStable: boolean
}
export type TemporalIncompatibility = { where: string; text: string; family: "STABILITY" | "CHANGE"; language: string[]; reason: TemporalRejectionReason; detail: string }

const CHANGE_CLAIM_RELATIONS: readonly TemporalRelation[] = ["EARLIER_VS_LATER", "TREND", "CHANGE", "TEMPORAL_CONCENTRATION", "POSITION"]

/**
 * COMPATIBILIDADE DO TEXTO COM A CONCLUSÃO (§14/§18 — transversal): estabilidade só com relação STABLE sustentada, claim
 * STABILITY aceita ou indicador STABLE; mudança/tendência/posição só com relação de mudança sustentada, claim de mudança
 * aceita ou fato comparativo de indicador. NO_DIFFERENCE_SUPPORTED + "permaneceu estável" = incompatível; a formulação
 * segura ("não foi encontrada diferença temporal sustentada") passa. Determinístico, sem LLM juiz.
 */
export function checkTemporalConclusionCompatibility(surfaces: TemporalSurface[], authorization: TemporalAuthorization): TemporalIncompatibility[] {
  const { conclusion } = authorization
  const stabilityAllowed = authorization.acceptedRelations.includes("STABILITY") || conclusion.allowedRelations.includes("STABILITY") || authorization.indicatorStable
  // V1.4.1: relação sustentada só na AMOSTRA não autoriza linguagem de mudança do colaborador no texto — precisa de claim aceita
  // (escopo INTERACTION_SPECIFIC, fato de amostra), suporte ≥ RECORDED_UNIVERSE ou fato comparativo de indicador.
  const changeAllowed = authorization.acceptedRelations.some((relation) => CHANGE_CLAIM_RELATIONS.includes(relation)) || (conclusion.allowedRelations.some((relation) => relation !== "STABILITY") && (conclusion.supportScope ?? "SAMPLE") !== "SAMPLE") || authorization.indicatorTemporalFact
  const out: TemporalIncompatibility[] = []
  for (const surface of surfaces) {
    const stability = detectStabilityLanguage(surface.text)
    if (stability.length > 0 && !stabilityAllowed) out.push({ ...surface, family: "STABILITY", language: stability, reason: "TEMPORAL_CONCLUSION_INCOMPATIBLE", detail: `${surface.where} afirma estabilidade ("${stability[0]}") mas a conclusão temporal autorizada é ${conclusion.kind} — ${conclusion.safeMeaning}${conclusion.kind === "NO_DIFFERENCE_SUPPORTED" ? ' ("nenhuma diferença sustentada" não é "permaneceu estável")' : ""}` })
    const change = detectChangeLanguage(surface.text)
    if (change.length > 0 && !changeAllowed) out.push({ ...surface, family: "CHANGE", language: change, reason: conclusion.kind === "NOT_COMPARED" ? "TEMPORAL_RELATION_UNDECLARED" : conclusion.kind === "SUPPORTED_RELATION" ? "TEMPORAL_SUPPORT_SCOPE" : "TEMPORAL_CONCLUSION_INCOMPATIBLE", detail: conclusion.kind === "NOT_COMPARED" ? `${surface.where} afirma relação temporal de período ("${change[0]}") sem claim temporal validada nem fato comparativo no ledger` : conclusion.kind === "SUPPORTED_RELATION" ? `${surface.where} afirma mudança do colaborador ("${change[0]}") mas a relação sustentada vale só para as AMOSTRAS comparadas (escopo de suporte SAMPLE) — descreva o fato da amostra` : `${surface.where} afirma mudança/tendência/posição ("${change[0]}") mas a conclusão temporal autorizada é ${conclusion.kind} — ${conclusion.safeMeaning}` })
  }
  return out
}

/** Soma à telemetria as claims temporais propostas/aceitas/rejeitadas a partir da síntese validada e das rejeições do gating (1ª tentativa + final). */
export function foldTemporalClaims(telemetry: TemporalTelemetry, synthesis: { behavioralClaims: { temporalRelation?: TemporalRelation | undefined }[] } | null | undefined, rejected: { kind: string; reason: string }[]): TemporalTelemetry {
  const accepted = (synthesis?.behavioralClaims ?? []).filter((claim) => claim.temporalRelation && claim.temporalRelation !== "NONE").length
  const temporalRejections = rejected.filter((item) => item.kind === "TEMPORAL_CLAIM")
  const reasons = { ...telemetry.rejectionReasons }
  for (const item of temporalRejections) {
    const reason = (TEMPORAL_REJECTION_REASONS as readonly string[]).find((code) => item.reason.startsWith(code)) as TemporalRejectionReason | undefined
    if (reason) reasons[reason] += 1
  }
  return { ...telemetry, temporalClaimsProposed: accepted + temporalRejections.length, temporalClaimsAccepted: accepted, temporalClaimsRejected: temporalRejections.length, rejectionReasons: reasons }
}
