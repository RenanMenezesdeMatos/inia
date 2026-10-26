import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { syntheticCorpusHashOf, syntheticCorpusSchema, syntheticAnswerKeySchema, type SyntheticCorpus, type SyntheticAnswerKey } from "../domain/synthetic-corpus.js"

/**
 * DATASETS SINTÉTICOS — gravados SÓ por script/prova (nunca por rota), recusados em produção. Mesmo dataset de novo = atualiza o
 * corpus no lugar (a chave é a identidade); análises e padrões antigos daquele dataset ficam (são rastreáveis), e `remove` apaga o
 * dataset com tudo que nasceu dele (cascata: análises, padrões, versões, evidências, codificações).
 */
export type SyntheticDatasetInput = { key: string; version: number; label: string; description: string; corpus: SyntheticCorpus; answerKey: SyntheticAnswerKey | null }

function refuseInProduction() {
  if (process.env.NODE_ENV === "production") throw new DomainError("Dados sintéticos não são carregados em produção.", "BEST_PRACTICE_SYNTHETIC_DISABLED", 403)
}

export async function upsertSyntheticDataset(db: Pick<Database, "query">, organizationId: string, input: SyntheticDatasetInput): Promise<{ id: string; created: boolean }> {
  refuseInProduction()
  const corpus = syntheticCorpusSchema.parse(input.corpus)
  const answerKey = input.answerKey ? syntheticAnswerKeySchema.parse(input.answerKey) : null
  const row = (await db.query<{ id: string; created: boolean }>(
    `insert into best_practice_synthetic_datasets (organization_id, dataset_key, version, label, description, corpus, corpus_hash, answer_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (organization_id, dataset_key) do update set version = excluded.version, label = excluded.label, description = excluded.description, corpus = excluded.corpus, corpus_hash = excluded.corpus_hash, answer_key = excluded.answer_key, updated_at = now()
     returning id, (xmax = 0) created`,
    [organizationId, input.key, input.version, input.label, input.description, JSON.stringify(corpus), syntheticCorpusHashOf(corpus), answerKey ? JSON.stringify(answerKey) : null],
  )).rows[0]!
  return row
}

export async function removeSyntheticDataset(db: Pick<Database, "query">, organizationId: string, key: string): Promise<boolean> {
  refuseInProduction()
  return ((await db.query(`delete from best_practice_synthetic_datasets where organization_id = $1 and dataset_key = $2`, [organizationId, key])).rowCount ?? 0) > 0
}
