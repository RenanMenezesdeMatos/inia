import type { ReviewStatus } from "../domain/feedback-review.js"
import type { ReviewContext, ReviewQueueItemRecord } from "../domain/review-view.js"
import type { ItemReviewRecord } from "./ports.js"
import type { ReliableReviewRecord } from "../../reliable-feedback/application/ports.js"
import type { ReliableFeedbackArtifactV1 } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"

/**
 * LEITURA DO QA DE FEEDBACK (V1.5.4 → V1.5.5 → V1.5.7), sempre ESCOPADA ao avaliador.
 *
 * Quem avalia NÃO é "o gestor do colaborador" nem quem tem certo cargo: é a CONTA com o papel `QA_DE_FEEDBACK` (modelo geral
 * de acesso, modules/access) — permissões `feedback_quality_review.view` (fila/detalhe) e `feedback_quality_review.decide`
 * (avaliar). Nenhum papel/cargo a recebe implicitamente. O escopo vem da atribuição, sempre dentro da organização da sessão:
 *   MY_STRUCTURE  → quem está abaixo do avaliador por reports_to_id (a MESMA CTE de `loadDescendants`);
 *   GROUP/SUBGROUP → colaboradores do Grupo/Subgrupo (estrutura atual da pessoa) — sem exigir que o avaliador lidere alguém;
 *   ORGANIZATION  → a organização inteira.
 * A fila mostra só itens SELECIONADOS PARA QA (HOLD_FOR_QA). Ninguém avalia o próprio feedback. Fora do escopo = "não
 * encontrado", sem distinguir; sem a permissão = 403.
 */
export type ReviewViewer = { organizationId: string; personId: string }
export type QaPermission = "feedback_quality_review.view" | "feedback_quality_review.decide"
export type QaGrantScopeType = "ORGANIZATION" | "GROUP" | "SUBGROUP" | "MY_STRUCTURE"
export type QaGrantScope = { scopeType: QaGrantScopeType; teamId: string | null; subteamId: string | null }

export type ReviewQueueFilters = {
  status: ReviewStatus | "ALL"
  /** Busca pelo nome do colaborador (texto simples, sem curingas). */
  search?: string | undefined
  collaboratorId?: string | undefined
  teamId?: string | undefined
  section?: "STRENGTH" | "OPPORTUNITY" | undefined
  /** Datas locais (fuso da organização), inclusivas, sobre a data da interação (ou da criação, se não houver). */
  from?: string | undefined
  to?: string | undefined
  page: number
  pageSize: number
}
export type ReviewQueueRow = { record: ReviewQueueItemRecord; context: ReviewContext }
export type ReviewQueuePage = { rows: ReviewQueueRow[]; total: number; filterOptions: { collaborators: { id: string; name: string }[]; teams: { id: string; name: string }[] } }
export type ReviewKnowledgeRow = { documentTitle: string; href: string | null; deliveryStatus: string }
/**
 * V1.5.12: a fila de QA também recebe itens do FEEDBACK CONFIÁVEL do Workflow (`origin: "WORKFLOW"`, tabela
 * `reliable_feedback_item_reviews`) — mesmo escopo, mesma decisão; a diferença é o efeito: a decisão retoma a matrícula em
 * vez de entregar. Ausente = item do feedback direto de atendimento (V1.5.4–V1.5.10).
 */
export type ScopedReview =
  | { origin?: "INTERACTION"; record: ItemReviewRecord; context: ReviewContext; knowledge: ReviewKnowledgeRow[] }
  /** V1.7.1e — `analysis` = o artefato inteiro e TODAS as revisões dele (a prévia do feedback completo e a navegação entre os
   * pontos da mesma análise); ausente/null em leitores antigos → o detalhe mostra só o item. */
  | { origin: "WORKFLOW"; record: ReliableReviewRecord; context: ReviewContext; knowledge: ReviewKnowledgeRow[]; analysis?: { artifact: ReliableFeedbackArtifactV1; reviews: ReliableReviewRecord[] } | null }

export interface FeedbackReviewReader {
  /** Escopos em que a conta do avaliador tem a permissão (atribuições ativas; vazio = sem a permissão). */
  grantsOf(viewer: ReviewViewer, permission: QaPermission): Promise<QaGrantScope[]>
  listQueue(viewer: ReviewViewer, filters: ReviewQueueFilters): Promise<ReviewQueuePage>
  /** O item SÓ se estiver selecionado para QA e no escopo da permissão pedida (null = inexistente, de outra organização ou fora do escopo). */
  loadInScope(viewer: ReviewViewer, reviewId: string, permission?: QaPermission): Promise<ScopedReview | null>
}
