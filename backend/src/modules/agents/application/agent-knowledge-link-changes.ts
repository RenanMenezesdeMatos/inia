import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { universesCompatible } from "../../operating-universe/domain/operating-universe.js"
import { sameAgentConfig, type AgentConfig } from "../domain/agent-config.js"
import { agentNotFound, authorizeAgentConfig, lifecycleForWrite, nextConfig, rethrowNameTaken } from "./agent-config-rules.js"
import { publishCheckedDraft, saveDraftWithHistory } from "./agent-draft-writes.js"
import { draftHasOtherChanges, knowledgeIdsAfter, loadKnowledgeLinkCandidates, type KnowledgeLinkCandidate, type KnowledgeLinkContext } from "./agent-knowledge-links.js"
import { computePublishImpact } from "./agent-publish-impact.js"
import { assertDraftRevision, loadAgentLifecycle, loadLiveAgentConfig, type AgentActor, type AgentLifecycleRow } from "./agent-versions.js"

/**
 * CASO DE USO da associação a partir da base (prévia e gravação): ligar ou desligar a base em cada agente escolhido, no rascunho ou
 * publicando. Saiu do router de agentes (run-8, ARQ-02). As regras são as do cadastro do agente (`nextConfig`, `saveDraftWithHistory`,
 * `publishCheckedDraft`); aqui só a decisão por agente e a ordem das escritas.
 */

/** Até 50 agentes por vez (run-8, SB-03: cada agente custa ~15 consultas e trava a linha dele até o fim da transação). */
export const MAX_KNOWLEDGE_LINK_CHANGES = 50

export type KnowledgeLinkMode = "DRAFT" | "PUBLISH"
export type KnowledgeLinkChange = { agentId: string; linked: boolean; expectedDraftRevision: number }
export type KnowledgeLinkRequest = { mode: KnowledgeLinkMode; changes: readonly KnowledgeLinkChange[] }
export type KnowledgeLinkOutcome = "UNCHANGED" | "DRAFT_SAVED" | "PUBLISHED" | "DRAFT_ONLY_OTHER_CHANGES"

type KnowledgeLinkPlan = {
  base: AgentConfig
  config: AgentConfig
  outcome: KnowledgeLinkOutcome
  firstPublication: boolean
  /** A configuração em edição muda (a base entra ou sai do rascunho). */
  changesDraft: boolean
}

/** A base e o agente precisam ser do mesmo universo para LIGAR (pendente de qualquer lado não é conflito). */
function assertSameUniverse(context: KnowledgeLinkContext, candidate: KnowledgeLinkCandidate): void {
  if (universesCompatible(context.knowledgeUniverse, candidate.operatingUniverse)) return
  throw new DomainError(`A base é do universo ${context.knowledgeUniverse} e o agente "${candidate.name}", do ${candidate.operatingUniverse} — universos não se misturam.`, "OPERATING_UNIVERSE_LINK_CONFLICT", 409)
}

/**
 * O que acontece em UM agente — a mesma conta na prévia e na gravação. A configuração seguinte sai de `nextConfig` (a validação da
 * edição: alcance, bases existentes e que cabem no Grupo), a revisão é conferida (PEN-050) e o universo da base precisa ser o do agente.
 */
async function planKnowledgeLink(client: Pick<Database, "query">, context: KnowledgeLinkContext, candidate: KnowledgeLinkCandidate, lifecycle: AgentLifecycleRow, change: KnowledgeLinkChange, mode: KnowledgeLinkMode): Promise<KnowledgeLinkPlan> {
  assertDraftRevision(lifecycle, change.expectedDraftRevision)
  const live = lifecycle.currentVersionId ? await loadLiveAgentConfig(client, lifecycle.organizationId, lifecycle.id) : null
  const base = lifecycle.draftConfig ?? live
  if (!base) throw agentNotFound()
  authorizeAgentConfig(context.scopes, base)
  const config = await nextConfig(client, lifecycle.organizationId, context.scopes, base, { knowledgeDocumentIds: knowledgeIdsAfter(base.knowledgeDocumentIds, context.knowledgeDocumentId, change.linked) })
  if (change.linked) assertSameUniverse(context, candidate)
  const firstPublication = lifecycle.currentVersionId === null
  const changesDraft = !sameAgentConfig(base, config)
  let outcome: KnowledgeLinkOutcome = changesDraft ? "DRAFT_SAVED" : "UNCHANGED"
  if (mode === "PUBLISH") {
    const pendingAfter = firstPublication || !live || !sameAgentConfig(live, config)
    if (pendingAfter) outcome = draftHasOtherChanges(live, lifecycle.draftConfig) ? "DRAFT_ONLY_OTHER_CHANGES" : "PUBLISHED"
  }
  return { base, config, outcome, firstPublication, changesDraft }
}

/** Agentes pedidos, cada um no alcance de quem pede (fora dele = 404, como no cadastro), na ordem dos ids (travas sem impasse). */
async function candidatesFor(db: Pick<Database, "query">, organizationId: string, context: KnowledgeLinkContext, changes: readonly KnowledgeLinkChange[]): Promise<{ candidate: KnowledgeLinkCandidate; change: KnowledgeLinkChange }[]> {
  const byId = new Map(changes.map((change) => [change.agentId, change]))
  const candidates = new Map((await loadKnowledgeLinkCandidates(db, organizationId, context, [...byId.keys()])).map((candidate) => [candidate.id, candidate]))
  return [...byId.keys()].sort().map((agentId) => {
    const candidate = candidates.get(agentId)
    if (!candidate) throw agentNotFound()
    return { candidate, change: byId.get(agentId)! }
  })
}

/**
 * Prévia (nada é gravado): o resultado em cada agente e, para quem seria publicado, a mesma prévia de impacto da publicação do agente.
 * Um agente com problema (revisão desatualizada, alcance, universo) volta com o motivo — a gravação recusaria o lote inteiro.
 */
export async function previewKnowledgeLinks(db: Database, viewer: { organizationId: string; sub: string }, context: KnowledgeLinkContext, request: KnowledgeLinkRequest) {
  const agents = []
  for (const { candidate, change } of await candidatesFor(db, viewer.organizationId, context, request.changes)) {
    const lifecycle = await loadAgentLifecycle(db, viewer.organizationId, candidate.id)
    if (!lifecycle) throw agentNotFound()
    try {
      const plan = await planKnowledgeLink(db, context, candidate, lifecycle, change, request.mode)
      const impact = plan.outcome === "PUBLISHED" ? await computePublishImpact(db, viewer, candidate.id, { nextConfig: plan.config, authorizeTarget: (config) => authorizeAgentConfig(context.scopes, config) }) : null
      agents.push({ agentId: candidate.id, name: candidate.name, outcome: plan.outcome, firstPublication: plan.firstPublication, problem: null, impact })
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      agents.push({ agentId: candidate.id, name: candidate.name, outcome: null, firstPublication: lifecycle.currentVersionId === null, problem: { code: error.code, message: error.message }, impact: null })
    }
  }
  return { mode: request.mode, agents }
}

/**
 * Grava em todos os agentes pedidos numa transação só (tudo ou nada): o rascunho de cada um e, no modo PUBLISH, a publicação, com a
 * mesma revalidação da rota de publicar. Agente publicado com outras alterações pendentes recebe a base só no rascunho.
 */
export async function applyKnowledgeLinks(db: Database, organizationId: string, context: KnowledgeLinkContext, request: KnowledgeLinkRequest, actor: AgentActor) {
  const targets = await candidatesFor(db, organizationId, context, request.changes)
  const results = await inTransaction(db, async (client) => {
    const outcomes: { agentId: string; name: string; outcome: KnowledgeLinkOutcome; versionNumber: number | null }[] = []
    for (const { candidate, change } of targets) {
      const lifecycle = await lifecycleForWrite(client, organizationId, candidate.id)
      const plan = await planKnowledgeLink(client, context, candidate, lifecycle, change, request.mode)
      if (plan.changesDraft) await saveDraftWithHistory(client, lifecycle, plan.base, plan.config, actor)
      let versionNumber: number | null = null
      if (plan.outcome === "PUBLISHED") {
        const saved = await lifecycleForWrite(client, organizationId, candidate.id)
        if (saved.draftConfig) versionNumber = (await publishCheckedDraft(client, saved, context.scopes, actor)).number
      }
      outcomes.push({ agentId: candidate.id, name: candidate.name, outcome: plan.outcome, versionNumber })
    }
    return outcomes
  }).catch(rethrowNameTaken)
  return { mode: request.mode, results }
}

