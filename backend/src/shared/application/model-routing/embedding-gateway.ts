import { randomUUID } from "node:crypto"
import type { LlmRequestSource } from "../llm-telemetry.js"
import { runLimitedAiCall } from "./ai-call-limiter.js"
import { aiRuntime } from "./ai-runtime.js"

/**
 * EMBEDDING pela policy da organização (Use Case KNOWLEDGE_EMBEDDING — busca nas bases em escala). Sem policy (ou sem runtime) não há
 * chamada nenhuma: quem pede cai no índice de texto de sempre. Passa pelo limitador como qualquer chamada de IA (a pergunta do chat é
 * interativa; a indexação no worker é lote) e registra uso e custo pelo runtime.
 */
export const KNOWLEDGE_EMBEDDING_USE_CASE = "KNOWLEDGE_EMBEDDING" as const

/** Modelo de embedding da policy ACTIVE agora (identidade do índice), ou null. */
export async function knowledgeEmbeddingModel(organizationId: string): Promise<string | null> {
  const runtime = aiRuntime()
  if (!runtime?.embeddingModelWithPolicy) return null
  return runtime.embeddingModelWithPolicy({ organizationId, useCase: KNOWLEDGE_EMBEDDING_USE_CASE })
}

export type KnowledgeEmbeddingRequest = { organizationId: string; texts: readonly string[]; purpose: "DOCUMENT" | "QUERY"; modelKey: string; stage: "INDEX" | "QUERY"; source: LlmRequestSource }

/** Um vetor por texto, na ordem, gerados EXATAMENTE pelo modelo `modelKey`; null = sem policy. Falha do provider sobe (AiProviderError). */
export async function embedKnowledgeTexts(request: KnowledgeEmbeddingRequest): Promise<Float32Array[] | null> {
  const runtime = aiRuntime()
  if (!runtime?.embedWithPolicy || request.texts.length === 0) return request.texts.length === 0 ? [] : null
  const result = await runLimitedAiCall(KNOWLEDGE_EMBEDDING_USE_CASE, {}, () =>
    runtime.embedWithPolicy!({
      organizationId: request.organizationId,
      useCase: KNOWLEDGE_EMBEDDING_USE_CASE,
      classification: { phase: "KNOWLEDGE", purpose: KNOWLEDGE_EMBEDDING_USE_CASE, source: request.source, semanticType: "TEXT", tags: [`stage:${request.stage}`] },
      correlationId: randomUUID(),
      texts: request.texts,
      purpose: request.purpose,
      modelKey: request.modelKey,
    }),
  )
  return result ? result.vectors : null
}
