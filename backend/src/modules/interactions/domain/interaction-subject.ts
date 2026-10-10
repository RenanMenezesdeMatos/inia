/**
 * ASSUNTO DE INTERAÇÃO — dois conceitos que nunca se misturam (migration 075):
 *   - rawSubject (`interactions.reason`): o que a FONTE cadastrou. Verdade da origem; nunca reescrito,
 *     nunca classificado/redefinido por IA;
 *   - canonicalSubject: código do catálogo da organização (`interaction_subject_definitions`) ao qual o
 *     bruto está ligado por um alias EXPLÍCITO (`interaction_subject_aliases`, texto exato ignorando
 *     caixa/espaços). Existe só para comparação determinística; bruto ambíguo = sem alias = nulo.
 * Assunto (bruto ou canônico) é DIMENSÃO/categoria — jamais causa: a IA continua tendo que investigar
 * transcrições e evidências.
 */
export const INTERACTION_SUBJECT_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/

export function normalizeRawSubject(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isInteractionSubjectCode(value: string): boolean {
  return INTERACTION_SUBJECT_CODE_PATTERN.test(value)
}

/**
 * Expressão SQL (subselect) com o código canônico da interação `${interactionAlias}` — nulo sem alias
 * ou com definição inativa. Um bruto tem no máximo UM alias (índice único), então `limit 1` nunca escolhe.
 */
export function canonicalSubjectSql(interactionAlias = "i"): string {
  return `(select d.code from interaction_subject_aliases a join interaction_subject_definitions d on d.id = a.subject_definition_id and d.active
           where a.organization_id = ${interactionAlias}.organization_id and lower(btrim(a.raw_subject)) = lower(btrim(${interactionAlias}.reason)) limit 1)`
}

/**
 * Cláusula de filtro por assunto para `${interactionAlias}`: canônico quando o pedido resolveu para um
 * código (todas as interações cujo bruto tem alias para ele), senão igualdade exata do bruto.
 * `$${paramIndex}` recebe o código canônico ou o bruto pedido, conforme o modo.
 */
export function subjectFilterSql(resolution: SubjectResolution, paramIndex: number, interactionAlias = "i"): { clause: string; param: string } {
  if (resolution.canonical) return { clause: ` and ${canonicalSubjectSql(interactionAlias)} = $${paramIndex}`, param: resolution.canonical.code }
  return { clause: ` and ${interactionAlias}.reason = $${paramIndex}`, param: resolution.requested }
}

export type CanonicalSubject = { code: string; name: string }

/** Resolução de um assunto pedido por alguém (modelo, tela): código canônico direto, ou alias do bruto; senão nulo. */
export type SubjectResolution = { requested: string; canonical: CanonicalSubject | null; mode: "CANONICAL" | "RAW_EXACT" }
