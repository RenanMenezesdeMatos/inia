import type { LlmUsage } from "../../../shared/application/llm-telemetry.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import type { AiAdapterType } from "./ai-provider-catalog.js"

/**
 * EMBEDDING (Use Case KNOWLEDGE_EMBEDDING — busca nas bases em escala). O modelo é escolhido na tela de IA (Roteamento), como qualquer
 * outro: nenhum modelo de embedding é fixo no código. Vetores de modelos diferentes não se comparam, por isso o índice das bases é
 * guardado POR MODELO (`embeddingModelKey`) e a pergunta só é comparada com vetores do mesmo modelo — nunca um fallback para outro
 * modelo no meio de uma busca.
 */

/** Protocolos que a INIA sabe usar para gerar embeddings (`AiProviderAdapter.embed`): OpenAI e compatíveis (/v1/embeddings) e Gemini. */
export const EMBEDDING_ADAPTERS: readonly AiAdapterType[] = ["OPENAI_CHAT_COMPLETIONS", "GOOGLE_GENAI"]

/** Para que serve o vetor: o Gemini usa isso para otimizar (RETRIEVAL_DOCUMENT × RETRIEVAL_QUERY); a OpenAI ignora. */
export type EmbeddingPurpose = "DOCUMENT" | "QUERY"

/** Textos por chamada ao provider (o lote da indexação é cortado neste tamanho). Os dois protocolos aceitam pelo menos isto. */
export const EMBEDDING_BATCH_SIZE = 64
/** Caracteres de um texto enviado (≈ 2 mil tokens): trecho e cartão já ficam abaixo disso; a pergunta longa é cortada. */
export const EMBEDDING_MAX_TEXT_CHARS = 8_000

/** Identidade do índice: o modelo do provider. Dois cadastros do mesmo modelo (ex.: gateway local e API direta) geram vetores iguais. */
export function embeddingModelKey(providerModelId: string): string {
  return providerModelId.replace(/^models\//, "").trim()
}

/** Corta o texto no limite (sem quebrar par substituto do UTF-16). */
export function embeddingText(text: string): string {
  if (text.length <= EMBEDDING_MAX_TEXT_CHARS) return text
  const cut = text.slice(0, EMBEDDING_MAX_TEXT_CHARS)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

/**
 * Uso de uma chamada de embedding para o registro de custo. Provider que informa tokens (OpenAI/compatíveis) = o uso informado, sem
 * mudança. Provider que NÃO informa (Gemini `batchEmbedContents`) = entrada ESTIMADA pelo texto enviado (`estimateTokens`, ≈ 4 caracteres
 * por token) e saída 0 (embedding não gera texto): com a tabela de preço do modelo, o custo fica ESTIMATED como qualquer custo pela tabela
 * e entra no orçamento — antes ficava UNKNOWN e nenhum orçamento limitava o gasto da indexação. Sem tabela de preço continua UNKNOWN.
 */
export function embeddingUsageOf(usage: LlmUsage, texts: readonly string[]): LlmUsage {
  if (usage.promptTokens !== null) return usage.outputTokens === null ? { ...usage, outputTokens: 0 } : usage
  const promptTokens = texts.length === 0 ? 0 : estimateTokens(...texts)
  return { promptTokens, outputTokens: 0, totalTokens: promptTokens, cachedInputTokens: null, reasoningTokens: null }
}
