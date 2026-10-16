/**
 * ASSUNTO DE INTERAÇÃO — dois conceitos que nunca se misturam (migration 075):
 *   - assunto bruto: o que a FONTE cadastrou. Verdade da origem; nunca reescrito, nunca classificado/redefinido por IA;
 *   - canonicalSubject: código do catálogo da organização (`interaction_subject_definitions`) ao qual o
 *     bruto está ligado por um alias EXPLÍCITO (`interaction_subject_aliases`, texto exato ignorando
 *     caixa/espaços). Existe só para comparação determinística; bruto ambíguo = sem alias = nulo.
 * Assunto (bruto ou canônico) é DIMENSÃO/categoria — jamais causa: a IA continua tendo que investigar
 * transcrições e evidências.
 *
 * `SUBJECT_RESOLUTION_V2` (16/10/2026, migrations 145/146) — DOIS NÍVEIS, com o submotivo como preferencial:
 *   - ASSUNTO (nível preferencial, `SUBJECT`): o SUBMOTIVO (`interactions.sub_reason`) quando a fonte o informou; sem submotivo,
 *     o MOTIVO (`interactions.reason`) — então cargas antigas, o Subgrupo "Diagnóstico IA" e o lote homologado resolvem como na V1.
 *     Canônico: alias do PAR (motivo + submotivo) > alias do TEXTO do submotivo; sem submotivo, alias do texto do motivo. Submotivo
 *     sem alias fica no bruto do submotivo — nunca sobe para o canônico do motivo;
 *   - MOTIVO (nível genérico, `REASON`): sempre `interactions.reason`, canônico pelo alias do texto (sem restrição de motivo).
 * Os dois níveis usam o MESMO catálogo de códigos; um código nunca mistura níveis numa mesma consulta.
 */
export const SUBJECT_RESOLUTION_VERSION = "SUBJECT_RESOLUTION_V2" as const
export const INTERACTION_SUBJECT_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/

/** Nível do assunto: `SUBJECT` = submotivo (ou motivo, sem submotivo) — o preferencial; `REASON` = só o motivo. */
export type SubjectLevel = "SUBJECT" | "REASON"

export function normalizeRawSubject(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isInteractionSubjectCode(value: string): boolean {
  return INTERACTION_SUBJECT_CODE_PATTERN.test(value)
}

/** Assunto bruto preferencial de uma interação já carregada: o submotivo, quando há; senão o motivo. */
export function rawSubjectOf(interaction: { reason: string | null; subReason?: string | null }): string | null {
  const subReason = interaction.subReason?.trim()
  return subReason ? interaction.subReason! : interaction.reason
}

const aliasCodeSql = (interactionAlias: string, where: string) =>
  `(select d.code from interaction_subject_aliases a join interaction_subject_definitions d on d.id = a.subject_definition_id and d.active
           where a.organization_id = ${interactionAlias}.organization_id and ${where} limit 1)`
const sameText = (column: string, value: string) => `lower(btrim(${column})) = lower(btrim(${value}))`
const hasSubReasonSql = (interactionAlias: string) => `nullif(btrim(${interactionAlias}.sub_reason), '') is not null`

/** Expressão SQL do assunto BRUTO preferencial de `${interactionAlias}`: submotivo, ou o motivo quando não há submotivo. */
export function rawSubjectSql(interactionAlias = "i"): string {
  return `coalesce(nullif(btrim(${interactionAlias}.sub_reason), ''), ${interactionAlias}.reason)`
}

/**
 * Expressão SQL (subselect) com o código canônico PREFERENCIAL da interação `${interactionAlias}` — nulo sem alias ou com
 * definição inativa. Com submotivo: par (motivo + submotivo), senão texto do submotivo. Sem submotivo: texto do motivo. Um par ou
 * texto tem no máximo UM alias (índice único da 146), então `limit 1` nunca escolhe.
 */
export function canonicalSubjectSql(interactionAlias = "i"): string {
  const pair = aliasCodeSql(interactionAlias, `a.raw_reason is not null and ${sameText("a.raw_reason", `${interactionAlias}.reason`)} and ${sameText("a.raw_subject", `${interactionAlias}.sub_reason`)}`)
  const subText = aliasCodeSql(interactionAlias, `a.raw_reason is null and ${sameText("a.raw_subject", `${interactionAlias}.sub_reason`)}`)
  return `(case when ${hasSubReasonSql(interactionAlias)} then coalesce(${pair}, ${subText}) else ${canonicalReasonSql(interactionAlias)} end)`
}

/** Expressão SQL (subselect) com o código canônico do MOTIVO de `${interactionAlias}` (alias do texto, sem restrição de motivo). */
export function canonicalReasonSql(interactionAlias = "i"): string {
  return aliasCodeSql(interactionAlias, `a.raw_reason is null and ${sameText("a.raw_subject", `${interactionAlias}.reason`)}`)
}

/** Chave de recorte do ASSUNTO (nível preferencial): canônico, senão o bruto preferencial. Nula = sem assunto. */
export function subjectKeySql(interactionAlias = "i"): string {
  return `coalesce(${canonicalSubjectSql(interactionAlias)}, nullif(btrim(${rawSubjectSql(interactionAlias)}), ''))`
}

/** Chave de recorte do MOTIVO: canônico do motivo, senão o motivo bruto. Nula = sem motivo. */
export function reasonKeySql(interactionAlias = "i"): string {
  return `coalesce(${canonicalReasonSql(interactionAlias)}, nullif(btrim(${interactionAlias}.reason), ''))`
}

/** Chave de recorte do nível pedido. */
export function levelKeySql(level: SubjectLevel, interactionAlias = "i"): string {
  return level === "REASON" ? reasonKeySql(interactionAlias) : subjectKeySql(interactionAlias)
}

/** Código canônico do nível pedido. */
export function levelCanonicalSql(level: SubjectLevel, interactionAlias = "i"): string {
  return level === "REASON" ? canonicalReasonSql(interactionAlias) : canonicalSubjectSql(interactionAlias)
}

/**
 * Cláusula de filtro por assunto para `${interactionAlias}`, no nível pedido (padrão: o preferencial). Canônico quando o pedido
 * resolveu para um código (todas as interações cujo bruto daquele nível tem alias para ele), senão igualdade exata do bruto do
 * nível (submotivo, ou o motivo quando não há submotivo; no nível REASON, o motivo). `$${paramIndex}` recebe o código ou o bruto.
 */
export function subjectFilterSql(resolution: SubjectResolution, paramIndex: number, interactionAlias = "i", level: SubjectLevel = "SUBJECT"): { clause: string; param: string } {
  if (resolution.canonical) return { clause: ` and ${levelCanonicalSql(level, interactionAlias)} = $${paramIndex}`, param: resolution.canonical.code }
  const raw = level === "REASON" ? `${interactionAlias}.reason` : rawSubjectSql(interactionAlias)
  return { clause: ` and ${raw} = $${paramIndex}`, param: resolution.requested }
}

export type CanonicalSubject = { code: string; name: string }

/** Resolução de um assunto pedido por alguém (modelo, tela): código canônico direto, ou alias do bruto; senão nulo. */
export type SubjectResolution = { requested: string; canonical: CanonicalSubject | null; mode: "CANONICAL" | "RAW_EXACT" }
