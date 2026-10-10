import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"

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

/** Hash curto do texto — a ingestão faz upsert de `content` na MESMA versão (ver
 * ingestion-router.ts), então `version` sozinho não diz se a transcrição mudou; o checksum diz. */
export function transcriptChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}
