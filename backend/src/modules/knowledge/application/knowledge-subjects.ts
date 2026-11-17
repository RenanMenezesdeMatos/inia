import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { insertCanonicalSubject, type CanonicalSubjectOption } from "../../interactions/application/interaction-subject-catalog.js"

/**
 * ASSUNTOS DA BASE DE CONHECIMENTO (migration 224, 17/11/2026). São os assuntos canônicos das chamadas (`interaction_subject_definitions`),
 * o mesmo catálogo dos "Pedidos do cliente relacionados" dos Alinhamentos operacionais, cadastrável pela tela da Base. Uma base vale para
 * "Todos os assuntos" (ALL_SUBJECTS, sozinho), para 1..N assuntos (SUBJECT) ou para nenhum (lista vazia — nunca vira "todos").
 *
 * As versões gravadas antes da 224 citam o id antigo (`subjects`) e não são reescritas (versão publicada é imutável): o mapa
 * `knowledge_subject_canonical_map` traduz ao ler. Nenhum fluxo de IA lê estes assuntos hoje — são classificação da base (lista, filtro,
 * histórico, exportação de configuração).
 */
type Queryable = Pick<Database, "query">

export type KnowledgeSubjectScope = { scopeType: string; subjectId?: string | null | undefined }

/** De/para dos ids antigos (`subjects`) citados em versões gravadas antes da 224. Id que já é canônico não aparece no mapa. */
export async function legacySubjectMap(db: Queryable, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (wanted.length === 0) return new Map()
  const rows = (await db.query<{ legacy_subject_id: string; interaction_subject_id: string }>(
    `select legacy_subject_id, interaction_subject_id from knowledge_subject_canonical_map where legacy_subject_id = any($1::uuid[])`,
    [wanted],
  )).rows
  return new Map(rows.map((row) => [row.legacy_subject_id, row.interaction_subject_id]))
}

/** Os mesmos alcances de assunto, com o id antigo trocado pelo canônico correspondente (e sem repetição). */
export async function canonicalSubjectScopes<T extends KnowledgeSubjectScope>(db: Queryable, scopes: readonly T[]): Promise<T[]> {
  const map = await legacySubjectMap(db, scopes.map((scope) => scope.subjectId))
  const seen = new Set<string>()
  const result: T[] = []
  for (const scope of scopes) {
    const subjectId = scope.subjectId ? (map.get(scope.subjectId) ?? scope.subjectId) : (scope.subjectId ?? null)
    const key = `${scope.scopeType}:${subjectId ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...scope, subjectId })
  }
  return result
}

/** Configuração de versão com os assuntos já no catálogo canônico. */
export async function withCanonicalSubjects<T extends { subjectScopes: KnowledgeSubjectScope[] }>(db: Queryable, config: T): Promise<T>
export async function withCanonicalSubjects<T extends { subjectScopes: KnowledgeSubjectScope[] }>(db: Queryable, config: T | null): Promise<T | null>
export async function withCanonicalSubjects<T extends { subjectScopes: KnowledgeSubjectScope[] }>(db: Queryable, config: T | null): Promise<T | null> {
  if (!config) return null
  return { ...config, subjectScopes: await canonicalSubjectScopes(db, config.subjectScopes) }
}

/** Nome de cada assunto citado (canônico ou id antigo de uma versão anterior à 224), só da organização. */
export async function knowledgeSubjectNames(db: Queryable, organizationId: string, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (wanted.length === 0) return new Map()
  const rows = (await db.query<{ id: string; name: string }>(
    `select d.id, d.name from interaction_subject_definitions d where d.organization_id = $1 and d.id = any($2::uuid[])
     union all
     select m.legacy_subject_id, d.name from knowledge_subject_canonical_map m join interaction_subject_definitions d on d.id = m.interaction_subject_id
      where m.organization_id = $1 and m.legacy_subject_id = any($2::uuid[])`,
    [organizationId, wanted],
  )).rows
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * Valida os assuntos que vão ser gravados: "Todos os assuntos" sozinho, assuntos sem repetição, cada um do catálogo da organização. Assunto
 * desativado só passa se a base já o tinha (`keep`): sai das opções, mas não é arrancado de quem já usa. Devolve a lista normalizada.
 */
export async function normalizeKnowledgeSubjectScopes(db: Queryable, organizationId: string, scopes: readonly KnowledgeSubjectScope[], keep: readonly KnowledgeSubjectScope[] = []): Promise<{ scopeType: "ALL_SUBJECTS" | "SUBJECT"; subjectId?: string }[]> {
  const canonical = await canonicalSubjectScopes(db, scopes)
  if (canonical.some((scope) => scope.scopeType === "ALL_SUBJECTS")) {
    if (canonical.length > 1) throw new DomainError("\"Todos os assuntos\" não leva assuntos específicos junto.", "KNOWLEDGE_SUBJECT_INVALID", 422)
    return [{ scopeType: "ALL_SUBJECTS" }]
  }
  const ids = canonical.map((scope) => {
    if (scope.scopeType !== "SUBJECT" || !scope.subjectId) throw new DomainError("Assunto inválido.", "KNOWLEDGE_SUBJECT_INVALID", 422)
    return scope.subjectId
  })
  if (ids.length === 0) return []
  const kept = new Set((await canonicalSubjectScopes(db, keep)).map((scope) => scope.subjectId).filter(Boolean))
  const found = new Map((await db.query<{ id: string; active: boolean; name: string }>(`select id, active, name from interaction_subject_definitions where organization_id = $1 and id = any($2::uuid[])`, [organizationId, ids])).rows.map((row) => [row.id, row]))
  for (const id of ids) {
    const subject = found.get(id)
    if (!subject) throw new DomainError("Assunto não encontrado nesta organização.", "KNOWLEDGE_SUBJECT_NOT_FOUND", 422)
    if (!subject.active && !kept.has(id)) throw new DomainError(`O assunto "${subject.name}" está desativado e não pode ser incluído.`, "KNOWLEDGE_SUBJECT_INACTIVE", 422)
  }
  return ids.map((subjectId) => ({ scopeType: "SUBJECT" as const, subjectId }))
}

/** Catálogo para a tela: ativos primeiro (os oferecidos) e os desativados marcados, para nomear o que bases antigas ainda citam. */
export async function listKnowledgeSubjects(db: Queryable, organizationId: string): Promise<CanonicalSubjectOption[]> {
  return (await db.query<CanonicalSubjectOption>(`select id, code, name, active from interaction_subject_definitions where organization_id = $1 order by active desc, name`, [organizationId])).rows
}

/**
 * Inclui um assunto pela tela da Base. O catálogo vale para a organização inteira (e serve também aos Alinhamentos e à classificação das
 * chamadas): quem chama confere o alcance de organização. Auditado.
 */
export async function createKnowledgeSubject(db: Queryable, actor: { organizationId: string; personId: string | null }, name: string): Promise<CanonicalSubjectOption> {
  const result = await insertCanonicalSubject(db, actor.organizationId, { name, description: "Incluído pela tela da Base de conhecimento." })
  if (result.outcome === "invalid") throw new DomainError("Use um nome com letras ou números.", "KNOWLEDGE_SUBJECT_INVALID", 422)
  if (result.outcome === "existing") throw new DomainError(`Já existe o assunto "${result.subject.name}"${result.subject.active ? "" : " (desativado)"}.`, "KNOWLEDGE_SUBJECT_DUPLICATED", 409)
  await db.query(
    `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'KNOWLEDGE_SUBJECT_CREATED', 'interaction_subject_definition', $3, $4::jsonb)`,
    [actor.organizationId, actor.personId, result.subject.id, JSON.stringify({ name: result.subject.name, code: result.subject.code })],
  )
  return result.subject
}
