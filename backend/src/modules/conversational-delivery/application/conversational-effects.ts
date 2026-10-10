import type { Database } from "../../../infrastructure/database/pool.js"
import { createPostgresReliableFeedbackStore } from "../../reliable-feedback/infrastructure/postgres-reliable-feedback-store.js"
import { prepareReliableEmission, type PreparedReliableEmission } from "../../reliable-feedback/infrastructure/publish-reliable-feedback.js"
import type { ReliableFeedbackStore } from "../../reliable-feedback/application/ports.js"
import type { ReliableFeedbackNodeOutput } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import type { ProjectionSource } from "../domain/surface-projection.js"
import { deliverChatConversation, offerAvatarDelivery, type AvatarOfferResult, type ChatDeliveryResult, type ConversationalDeliveryInput } from "./deliver-conversational-output.js"

/**
 * Fronteira de efeitos das superfícies CONVERSACIONAIS do nó Output (`WorkflowEffectSink.conversational`). Produção grava
 * (conversa + mensagem, convite de voz); o QA Lab implementa a mesma porta sem gravar nada.
 */
export type ConversationalEffects = {
  /** Fonte da projeção de um feedback confiável: lida do STORE (a fonte da verdade, com o texto final do QA), com as MESMAS
   * defesas da publicação no Acompanhamento — nunca do Execution Context. */
  reliableProjectionSource(db: Database, input: { organizationId: string; recipientId: string; artifactId: string; nodeOutput: ReliableFeedbackNodeOutput }): Promise<ProjectionSource>
  deliverChat(db: Database, input: ConversationalDeliveryInput): Promise<ChatDeliveryResult>
  offerAvatar(db: Database, input: ConversationalDeliveryInput): Promise<AvatarOfferResult>
}

/** ProjectionSource de uma emissão confiável preparada: a apresentação V2 quando existe; senão o card/abertura + texto emitível. */
export function projectionSourceOfPrepared(prepared: PreparedReliableEmission): ProjectionSource {
  const { record, output, feedbackView } = prepared
  if (feedbackView) return { kind: "FEEDBACK_VIEW", domain: record.domain, label: record.artifact.label, view: feedbackView, fullText: output.text }
  return { kind: "FEEDBACK_TEXT", domain: record.domain, label: record.artifact.label, card: output.presentation?.card ?? null, points: output.items.map((item) => item.wording.observed), fullText: output.text }
}

/** Fonte a partir do próprio nó "Gerar feedback" — só onde não há store (simulação sem artefato persistido). */
export function projectionSourceOfNodeOutput(nodeOutput: ReliableFeedbackNodeOutput): ProjectionSource {
  return { kind: "FEEDBACK_TEXT", domain: nodeOutput.domain, label: nodeOutput.label, card: nodeOutput.presentation?.card ?? null, points: nodeOutput.items.map((item) => item.wording.observed), fullText: nodeOutput.text }
}

export async function reliableProjectionSourceFrom(store: ReliableFeedbackStore, input: { organizationId: string; recipientId: string; artifactId: string }): Promise<ProjectionSource> {
  return projectionSourceOfPrepared(await prepareReliableEmission(store, input))
}

export const productionConversationalEffects: ConversationalEffects = {
  reliableProjectionSource: (db, input) => reliableProjectionSourceFrom(createPostgresReliableFeedbackStore(db), input),
  deliverChat: (db, input) => deliverChatConversation(db, input),
  offerAvatar: (db, input) => offerAvatarDelivery(db, input),
}
