import { AsyncLocalStorage } from "node:async_hooks"
import type { Database } from "../../../infrastructure/database/pool.js"
import { agentSnapshotFor } from "../../agents/application/agent-runtime-context.js"

/**
 * UMA CONSULTA, UMA VERSÃO POR BASE (PEN-008). Quem inicia a consulta (execução de agente, turno do chat ou da voz) roda dentro deste
 * contexto: a primeira leitura de cada base fixa a versão vigente daquele momento, e as leituras seguintes da mesma consulta usam
 * essa versão, mesmo que uma atualização fique pronta no meio. Assim uma consulta nunca mistura trechos de versões diferentes da
 * mesma base; a próxima consulta já começa na nova. O contexto também junta as versões efetivamente usadas, que quem grava o
 * resultado registra em `knowledge_version_usages`.
 */
export type KnowledgeVersionPin = { versionId: string; version: number }
export type KnowledgeVersionUse = KnowledgeVersionPin & { documentId: string; agentId: string | null; agentVersionId: string | null }

class KnowledgeConsultation {
  readonly pins = new Map<string, KnowledgeVersionPin>()
  private readonly used = new Map<string, KnowledgeVersionUse>()

  markUsed(use: KnowledgeVersionUse) {
    this.used.set(`${use.versionId}|${use.agentId ?? ""}`, use)
  }

  /** As versões usadas desde a última gravação: quem grava leva, e a próxima gravação da mesma consulta não repete. */
  drain(): KnowledgeVersionUse[] {
    const uses = [...this.used.values()]
    this.used.clear()
    return uses
  }
}

const storage = new AsyncLocalStorage<KnowledgeConsultation>()

/** Abre a consulta; dentro de outra, continua nela (um turno do chat com vários especialistas é uma consulta só). */
export function withKnowledgeConsultation<T>(run: () => Promise<T>): Promise<T> {
  return storage.getStore() ? run() : storage.run(new KnowledgeConsultation(), run)
}

export function currentKnowledgeConsultation(): KnowledgeConsultation | null {
  return storage.getStore() ?? null
}

/** A consulta de uma requisição inteira (o turno do chat e a chamada da voz): o que a resposta grava no fim ainda está dentro dela. */
export function knowledgeConsultationScope(_request: unknown, _response: unknown, next: () => void): void {
  storage.run(new KnowledgeConsultation(), next)
}

const VOICE_TURN_WINDOW = "15 minutes"

/**
 * Um turno de voz pode ter várias chamadas de ferramenta, cada uma numa requisição, e o processo pode ser outro a cada uma: o que fixa a
 * versão entre elas é o que a chamada anterior do MESMO turno já gravou (o `clientMessageId` da resposta começa pelo turno). Assim o turno
 * inteiro continua na versão com que começou. O identificador do turno vem do cliente: por isso só vale o que foi gravado há pouco, e reusar um
 * turno antigo não prende ninguém numa versão substituída. Falha aqui fica no log: a resposta segue, e a chamada lê a versão vigente.
 */
export async function continueVoiceTurnConsultation(db: Pick<Database, "query">, turn: { organizationId: string; conversationId: string; turnId: string }): Promise<void> {
  const consultation = currentKnowledgeConsultation()
  if (!consultation) return
  try {
    const rows = (await db.query<{ document_id: string; version_id: string; version: number }>(
      `select distinct on (u.document_id) u.document_id, u.version_id, u.version
         from assistant_interactions i
         join knowledge_version_usages u on u.source_kind = 'CONVERSATION' and u.source_id = i.id
        where i.conversation_id = $1 and i.organization_id = $2 and starts_with(i.client_message_id, $3) and u.created_at > now() - interval '${VOICE_TURN_WINDOW}'
        order by u.document_id, u.created_at`,
      [turn.conversationId, turn.organizationId, `${turn.turnId}:`],
    )).rows
    for (const row of rows) if (!consultation.pins.has(row.document_id)) consultation.pins.set(row.document_id, { versionId: row.version_id, version: row.version })
  } catch (error) {
    console.error(JSON.stringify({ event: "knowledge_voice_turn_continuity_failed", conversationId: turn.conversationId, message: (error as Error).message }))
  }
}

/** Marca as versões de onde saíram trechos usados pelo agente (a versão do agente vem do contexto da execução). */
export function markKnowledgeVersionsUsed(agentId: string | null, versions: readonly (KnowledgeVersionPin & { documentId: string })[]): void {
  const consultation = currentKnowledgeConsultation()
  if (!consultation) return
  const agentVersionId = agentSnapshotFor(agentId)?.versionId ?? null
  for (const version of versions) consultation.markUsed({ ...version, agentId, agentVersionId })
}

/** Marca como usadas as bases citadas por quem já leu pela consulta (o esclarecimento pelas bases), na versão fixada nela. */
export function markPinnedDocumentsUsed(agentId: string | null, documentIds: readonly string[]): void {
  const consultation = currentKnowledgeConsultation()
  if (!consultation) return
  markKnowledgeVersionsUsed(agentId, documentIds.flatMap((documentId) => {
    const pin = consultation.pins.get(documentId)
    return pin ? [{ ...pin, documentId }] : []
  }))
}

export type KnowledgeUsageSource = { sourceKind: "AGENT_RUN" | "CONVERSATION" | "WORKFLOW"; sourceId: string }

/**
 * Grava as versões usadas pela consulta em andamento, vinculadas ao que ela produziu (execução, resposta da conversa, execução de
 * Workflow). Só registro: uma falha aqui fica no log e não derruba a resposta já produzida.
 */
export async function recordKnowledgeUsage(db: Pick<Database, "query">, source: KnowledgeUsageSource): Promise<void> {
  const uses = currentKnowledgeConsultation()?.drain() ?? []
  if (uses.length === 0) return
  try {
    await db.query(
      `insert into knowledge_version_usages (organization_id, document_id, version_id, version, source_kind, source_id, agent_id, agent_version_id)
       select v.organization_id, u.document_id, u.version_id, u.version, $1, $2, u.agent_id, u.agent_version_id
         from unnest($3::uuid[], $4::uuid[], $5::int[], $6::uuid[], $7::uuid[]) as u(document_id, version_id, version, agent_id, agent_version_id)
         join knowledge_versions v on v.id = u.version_id
       on conflict (source_kind, source_id, version_id, agent_id) do nothing`,
      [source.sourceKind, source.sourceId, uses.map((use) => use.documentId), uses.map((use) => use.versionId), uses.map((use) => use.version), uses.map((use) => use.agentId), uses.map((use) => use.agentVersionId)],
    )
  } catch (error) {
    console.error(JSON.stringify({ event: "knowledge_usage_record_failed", sourceKind: source.sourceKind, sourceId: source.sourceId, message: (error as Error).message }))
  }
}
