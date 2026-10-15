/**
 * SITUAÇÃO FUNCIONAL do colaborador — domínio único (nunca `if status === "FERIAS"` espalhado
 * por Condition/Ranking/Analytics). A INIA consome esse dado da fonte de colaboradores; não é RH.
 *
 * Separado de `people.active` (cadastro/conta): uma pessoa pode ter conta ativa e estar de férias.
 * Situação funcional afeta SÓ a camada operacional (elegibilidade, cobertura, ranking, quartil,
 * tendência, população operacional) — nunca o fechamento oficial (atingimento/quartil/peso/PRV).
 */
/**
 * As NOVE situações funcionais reais do negócio (códigos internos seguros; rótulos em pt-BR).
 * Regra positiva ÚNICA: só EM_PRODUCAO significa "ativo operacionalmente, deveria produzir".
 */
export const EMPLOYMENT_STATUSES = ["EM_PRODUCAO", "TRANSFERIDO", "FERIAS", "INSS", "PILOTO", "MATERNIDADE", "PATERNIDADE", "APOSENTADO", "ATIVIDADE_OFF"] as const
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number]

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  EM_PRODUCAO: "EM PRODUÇÃO",
  TRANSFERIDO: "TRANSFERIDO",
  FERIAS: "FÉRIAS",
  INSS: "INSS",
  PILOTO: "PILOTO",
  MATERNIDADE: "MATERNIDADE",
  PATERNIDADE: "PATERNIDADE",
  APOSENTADO: "APOSENTADO",
  ATIVIDADE_OFF: "ATIVIDADE OFF",
}

/**
 * Códigos LEGADOS (058) que ainda podem existir em dados antigos, fixtures ou clientes da API.
 * O banco continua aceitando-os (dual-read); todo leitor canoniza com `toCanonicalEmploymentStatus`
 * e todo escritor passa pelo serviço, que canoniza na entrada. Mapa determinístico e SEM palpite:
 * LEAVE/INACTIVE viram ATIVIDADE_OFF (nunca INSS/MATERNIDADE/APOSENTADO sem evidência); o código
 * original fica em `legacy_status` (migration 062) e em `raw_status` quando a fonte não tinha texto.
 */
export const LEGACY_EMPLOYMENT_STATUSES = ["ACTIVE", "VACATION", "LEAVE", "INACTIVE"] as const
export type LegacyEmploymentStatus = (typeof LEGACY_EMPLOYMENT_STATUSES)[number]
export const LEGACY_EMPLOYMENT_STATUS_MAP: Record<LegacyEmploymentStatus, EmploymentStatus> = {
  ACTIVE: "EM_PRODUCAO",
  VACATION: "FERIAS",
  LEAVE: "ATIVIDADE_OFF",
  INACTIVE: "ATIVIDADE_OFF",
}

export function isLegacyEmploymentStatus(value: unknown): value is LegacyEmploymentStatus {
  return typeof value === "string" && (LEGACY_EMPLOYMENT_STATUSES as readonly string[]).includes(value)
}

/** Qualquer código (real ou legado) → código real. Desconhecido → null (nunca EM_PRODUCAO por palpite). */
export function toCanonicalEmploymentStatus(value: string | null | undefined): EmploymentStatus | null {
  if (value === null || value === undefined) return null
  if (isEmploymentStatus(value)) return value
  if (isLegacyEmploymentStatus(value)) return LEGACY_EMPLOYMENT_STATUS_MAP[value]
  return null
}

/** ÚNICA política de elegibilidade operacional por situação: regra POSITIVA — só EM PRODUÇÃO produz. */
export function isOperationallyEligibleStatus(status: EmploymentStatus | LegacyEmploymentStatus): boolean {
  return toCanonicalEmploymentStatus(status) === "EM_PRODUCAO"
}

/**
 * Situações NÃO elegíveis (reais + legadas ainda não canonizadas em algum registro antigo) — o
 * mesmo conjunto vai como parâmetro para o SQL do resolvedor de medições.
 */
export const NON_ELIGIBLE_EMPLOYMENT_STATUSES: string[] = [...EMPLOYMENT_STATUSES, ...LEGACY_EMPLOYMENT_STATUSES].filter((status) => !isOperationallyEligibleStatus(status))

export function isEmploymentStatus(value: unknown): value is EmploymentStatus {
  return typeof value === "string" && (EMPLOYMENT_STATUSES as readonly string[]).includes(value)
}

/**
 * Status BRUTO da fonte → situação real. SÓ mapeamentos explícitos e seguros: o próprio código,
 * o rótulo em pt-BR (com ou sem acento/espaço/underscore) e os dois códigos legados sem
 * ambiguidade (ACTIVE, VACATION). "ATIVO", "AFASTADO", "LICENÇA" etc. NÃO são traduzidos
 * automaticamente para fontes novas — o cliente mapeia os valores dele com "Mapear códigos" no
 * feed (transformação declarativa) e a INIA nunca chuta. O que não casa devolve null.
 */
const RAW_STATUS_SYNONYMS: Record<string, EmploymentStatus> = {
  EM_PRODUCAO: "EM_PRODUCAO",
  PRODUCAO: "EM_PRODUCAO",
  TRANSFERIDO: "TRANSFERIDO",
  TRANSFERIDA: "TRANSFERIDO",
  FERIAS: "FERIAS",
  INSS: "INSS",
  PILOTO: "PILOTO",
  MATERNIDADE: "MATERNIDADE",
  LICENCA_MATERNIDADE: "MATERNIDADE",
  PATERNIDADE: "PATERNIDADE",
  LICENCA_PATERNIDADE: "PATERNIDADE",
  APOSENTADO: "APOSENTADO",
  APOSENTADA: "APOSENTADO",
  ATIVIDADE_OFF: "ATIVIDADE_OFF",
  // Legado interno sem ambiguidade (compatibilidade com cargas/fixtures anteriores à 062).
  ACTIVE: "EM_PRODUCAO",
  VACATION: "FERIAS",
}

export function normalizeEmploymentStatus(raw: string | null | undefined): EmploymentStatus | null {
  if (raw === null || raw === undefined) return null
  const key = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (key === "") return null
  return RAW_STATUS_SYNONYMS[key] ?? null
}

export type StatusPeriod = {
  id: string
  personId: string
  status: EmploymentStatus
  rawStatus: string | null
  /** Código legado (058) que este período tinha antes do backfill da 062 — só auditoria. */
  legacyStatus: LegacyEmploymentStatus | null
  /** AAAA-MM-DD, inclusivo. */
  effectiveFrom: string
  /** AAAA-MM-DD, inclusivo; null = em aberto. */
  effectiveTo: string | null
  effectiveFromInferred: boolean
  /** O fim veio da FONTE (ausência explícita 04–20) — não de um vizinho que fechou o período. */
  effectiveToExplicit: boolean
  /** Veio de um feed autoritativo da Central (desempate entre evidências do mesmo nível). */
  authoritative: boolean
  observedAt: string
  sourceUpdatedAt: string | null
  source: string
  sourceReference: string | null
}

/** Situação vigente numa data local (AAAA-MM-DD) segundo os períodos; sem período = EM PRODUÇÃO presumido (nunca retroage sem evidência). */
export function employmentStatusOn(periods: Pick<StatusPeriod, "status" | "effectiveFrom" | "effectiveTo">[], date: string): EmploymentStatus {
  const covering = periods.find((period) => period.effectiveFrom <= date && (period.effectiveTo === null || period.effectiveTo >= date))
  return covering ? (toCanonicalEmploymentStatus(covering.status) ?? "EM_PRODUCAO") : "EM_PRODUCAO"
}

/**
 * BASE da situação numa data — a mesma resposta de `employmentStatusOn`, mas dizendo de onde ela
 * vem. A INIA não inventa certeza: "presumido" nunca é apresentado como "confirmado".
 *  - EXPLICIT_PERIOD: dia coberto por período com datas informadas pela fonte (ausência 04–20).
 *  - OPEN_PERIOD: dia coberto por período em aberto (snapshot "está de férias desde a carga de 15/09").
 *  - PRESUMED_AFTER_PERIOD: um período limitado terminou e nada foi informado depois → ATIVO presumido,
 *    NÃO confirmado (política documentada: nunca inventamos o retorno; sinalizamos que não sabemos).
 *  - PRESUMED_NO_HISTORY: pessoa sem nenhum período → ATIVO presumido (compatibilidade com o legado).
 */
export type StatusBasis = "EXPLICIT_PERIOD" | "OPEN_PERIOD" | "PRESUMED_AFTER_PERIOD" | "PRESUMED_NO_HISTORY"

export type ResolvedStatus<P extends Pick<StatusPeriod, "status" | "effectiveFrom" | "effectiveTo"> = StatusPeriod> = {
  status: EmploymentStatus
  basis: StatusBasis
  /** true quando a situação é sustentada por um período (explícito ou em aberto). */
  confirmed: boolean
  period: P | null
  /** Período limitado mais recente que terminou antes da data (base do PRESUMED_AFTER_PERIOD). */
  endedPeriod: P | null
}

export function resolveStatusBasis<P extends Pick<StatusPeriod, "status" | "effectiveFrom" | "effectiveTo"> & Partial<Pick<StatusPeriod, "effectiveFromInferred" | "effectiveToExplicit">>>(periods: P[], date: string): ResolvedStatus<P> {
  const covering = periods.find((period) => period.effectiveFrom <= date && (period.effectiveTo === null || period.effectiveTo >= date))
  if (covering) {
    const explicit = covering.effectiveToExplicit === true || (covering.effectiveTo !== null && covering.effectiveFromInferred === false)
    return { status: toCanonicalEmploymentStatus(covering.status) ?? "EM_PRODUCAO", basis: explicit ? "EXPLICIT_PERIOD" : "OPEN_PERIOD", confirmed: true, period: covering, endedPeriod: null }
  }
  const ended = periods.filter((period) => period.effectiveTo !== null && period.effectiveTo < date).sort((a, b) => b.effectiveTo!.localeCompare(a.effectiveTo!))[0] ?? null
  if (ended) return { status: "EM_PRODUCAO", basis: "PRESUMED_AFTER_PERIOD", confirmed: false, period: null, endedPeriod: ended }
  return { status: "EM_PRODUCAO", basis: "PRESUMED_NO_HISTORY", confirmed: false, period: null, endedPeriod: null }
}

export const STATUS_BASIS_LABELS: Record<StatusBasis, string> = {
  EXPLICIT_PERIOD: "Período informado pela fonte",
  OPEN_PERIOD: "Situação em aberto desde a última carga",
  PRESUMED_AFTER_PERIOD: "Em produção presumido após o fim do período (retorno não confirmado)",
  PRESUMED_NO_HISTORY: "Em produção presumido (sem histórico de situação)",
}

/**
 * Nível de evidência de um período/snapshot para PRECEDÊNCIA (nunca "quem chegou por último"):
 *  2 = período explícito e limitado (início e fim da fonte) — ausência explícita;
 *  1 = tudo o mais (snapshot em aberto, explícito ou inferido) — descreve "a partir de uma data".
 * Regra: 2 > 1 sempre; empate → feed autoritativo; empate → evidência mais nova (sourceUpdatedAt, senão observedAt).
 */
export function evidenceRank(period: { effectiveTo: string | null; effectiveToExplicit: boolean }): 1 | 2 {
  return period.effectiveTo !== null && period.effectiveToExplicit ? 2 : 1
}

/** Períodos de uma pessoa nunca se sobrepõem — mesma regra da exclusion constraint, checável em memória. */
export function findOverlap(periods: Pick<StatusPeriod, "effectiveFrom" | "effectiveTo">[]): [number, number] | null {
  const sorted = periods.map((period, index) => ({ ...period, index })).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!
    const current = sorted[i]!
    if (previous.effectiveTo === null || previous.effectiveTo >= current.effectiveFrom) return [previous.index, current.index]
  }
  return null
}

/**
 * CANCELAMENTO de um período pela própria fonte (ausência desfeita no RH): o que muda na linha do
 * tempo para ela voltar a refletir só as OUTRAS evidências. Regra única, pura:
 *  - o período cancelado sai;
 *  - o período anterior que termina na véspera volta a valer sobre os dias liberados quando o fim
 *    dele NÃO veio da fonte (só fechou porque a ausência começou): vale até a próxima situação
 *    registrada, ou em aberto. Se o posterior for a outra metade dele (mesma situação e mesma
 *    fonte, adjacente), os dois voltam a ser um só;
 *  - fim informado pela fonte é respeitado: as duas metades de um período explícito só se juntam
 *    quando são a mesma evidência (a cópia que a divisão criou);
 *  - fora isso os dias ficam sem período — EM PRODUÇÃO presumido, nunca uma situação inventada.
 * O início de um período posterior nunca é antecipado: a INIA não retroage por suposição.
 */
export type StatusCancellationPlan = {
  /** Saem, nesta ordem: o período cancelado e, numa fusão, a metade posterior. */
  remove: StatusPeriod[]
  /** Período anterior que passa a cobrir os dias liberados (null = os dias ficam presumidos). */
  restore: { period: StatusPeriod; effectiveTo: string | null; mergedWith: StatusPeriod | null } | null
}

export function planStatusPeriodCancellation(periods: readonly StatusPeriod[], target: StatusPeriod): StatusCancellationPlan {
  const others = periods.filter((period) => period.id !== target.id).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  const previous = others.find((period) => period.effectiveTo === addDaysToDate(target.effectiveFrom, -1))
  const following = target.effectiveTo === null ? undefined : others.find((period) => period.effectiveFrom > target.effectiveTo!)
  if (!previous) return { remove: [target], restore: null }
  const adjacent = following && following.effectiveFrom === addDaysToDate(target.effectiveTo!, 1) ? following : undefined
  const halves = adjacent !== undefined && adjacent.status === previous.status && adjacent.source === previous.source && (!previous.effectiveToExplicit || sameEvidence(previous, adjacent))
  if (halves) return { remove: [target, adjacent], restore: { period: previous, effectiveTo: adjacent.effectiveTo, mergedWith: adjacent } }
  if (previous.effectiveToExplicit) return { remove: [target], restore: null }
  return { remove: [target], restore: { period: previous, effectiveTo: following ? addDaysToDate(following.effectiveFrom, -1) : null, mergedWith: null } }
}

/** A metade posterior de uma divisão é cópia da anterior: mesma situação, fonte e evidência. */
function sameEvidence(a: StatusPeriod, b: StatusPeriod): boolean {
  const instant = (value: string | null) => (value === null ? null : Date.parse(value))
  return (
    a.rawStatus === b.rawStatus &&
    a.sourceReference === b.sourceReference &&
    a.effectiveToExplicit === b.effectiveToExplicit &&
    a.authoritative === b.authoritative &&
    instant(a.observedAt) === instant(b.observedAt) &&
    instant(a.sourceUpdatedAt) === instant(b.sourceUpdatedAt)
  )
}

export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days))
  return shifted.toISOString().slice(0, 10)
}
