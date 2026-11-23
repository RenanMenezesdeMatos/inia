import type { Database } from "../../../infrastructure/database/pool.js"
import { jargonRulesOf, type JargonRule } from "../domain/glossary-jargon.js"

/**
 * Interruptor da gíria do Glossário no vetor (`domain/glossary-jargon.ts`). DESLIGADO por padrão: só `on`/`true`/`1` liga. Vale para a
 * API (busca) e para o processamento (indexação e limpeza dos vetores) — os dois precisam do mesmo valor; reinicie ambos ao trocar.
 * Ligar ou desligar faz a indexação refazer as versões (`knowledge_embedding_index.jargon_key`, migration 251).
 */
export function knowledgeGlossaryJargonEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.INIA_KB_GLOSSARY_JARGON_VECTORS?.trim().toLowerCase()
  return value === "on" || value === "true" || value === "1"
}

/**
 * Regras do Glossário ativo da organização; a falha sobe. Indexação e limpeza usam esta: com o Glossário ilegível elas param a organização
 * na rodada — nunca tratam "não consegui ler" como "Glossário vazio" (isso refaria todas as versões e apagaria os vetores com gíria).
 */
export async function queryGlossaryJargonRules(db: Database, organizationId: string): Promise<JargonRule[]> {
  const result = await db.query<{ term: string; definition: string }>(`select term, definition from glossary_terms where organization_id = $1 and active`, [organizationId])
  return jargonRulesOf(result.rows)
}

/** Para a busca: falha = sem regras (procura pelos vetores sem gíria, que continuam valendo como reserva), nunca sem busca. */
export async function loadGlossaryJargonRules(db: Database, organizationId: string): Promise<JargonRule[]> {
  try {
    return await queryGlossaryJargonRules(db, organizationId)
  } catch (error) {
    console.error(JSON.stringify({ event: "glossary_jargon_load_failed", message: (error as Error).message }))
    return []
  }
}
