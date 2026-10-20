import { createHash } from "node:crypto"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"

export type TranscriptRecord = {
  content: string
  version: number
  language: string
  confidence: number | null
}

/**
 * Resolução ÚNICA "interação → transcrição vigente" — a versão mais recente de `transcripts`.
 * Usada pela engine (inputContext do enrollment), pelo executor de Actions (amostragem de
 * monitoria) e pelo QA Lab (massa de teste e detalhe da interação): QA e produção nunca podem
 * ler transcrições diferentes pra mesma chamada. Só leitura; nunca reprocessa áudio/STT.
 */
export async function loadLatestTranscript(db: Database, interactionId: string): Promise<TranscriptRecord | null> {
  const result = await db.query<{ content: string; version: number; language: string; confidence: string | null }>(
    `select content, version, language, confidence from transcripts where interaction_id = $1 order by version desc limit 1`,
    [interactionId],
  )
  const row = result.rows[0]
  if (!row) return null
  return { content: row.content, version: row.version ?? 1, language: row.language ?? "pt-BR", confidence: row.confidence == null ? null : Number(row.confidence) }
}

/**
 * TRANSCRIÇÃO PARA A IA (R-31, LGPD): o texto de chamada que vai para um modelo sai com CPF, telefone, e-mail e protocolo do
 * cliente trocados por marcadores ([CPF], [TELEFONE], [EMAIL], [PROTOCOLO]) — a mesma redação já aplicada às transcrições de
 * colegas (peer-privacy-projection.ts), agora também na do próprio colaborador analisado. Determinística: as citações do modelo
 * são conferidas contra ESTE texto (quem confere relê pelo mesmo caminho), então continuam literais. O original fica no banco.
 * Nomes não são redigidos: o do colaborador é o sujeito da análise e o do cliente não tem identidade estruturada.
 */
export const MODEL_TRANSCRIPT_PRIVACY_VERSION = "SUBJECT_PII_MASK_V1"

export function transcriptForModel(content: string): string {
  return env.INIA_MODEL_PII_MASKING === "ON" ? redactEvidentPii(content).text : content
}

/** `loadLatestTranscript` com o texto mascarado — para TODO uso que leva a transcrição a um modelo ou confere citações dele. */
export async function loadLatestTranscriptForModel(db: Database, interactionId: string): Promise<TranscriptRecord | null> {
  const record = await loadLatestTranscript(db, interactionId)
  return record ? { ...record, content: transcriptForModel(record.content) } : null
}

/** Hash curto do texto — a ingestão faz upsert de `content` na MESMA versão (ver
 * ingestion-router.ts), então `version` sozinho não diz se a transcrição mudou; o checksum diz. */
export function transcriptChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}
