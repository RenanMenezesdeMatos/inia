/**
 * CATÁLOGO DE RETENÇÃO — o que o mecanismo (application/run-data-retention.ts) sabe sobre cada tabela que pode ter prazo
 * (docs/dev/escala-read-model-e-ciclo-de-vida.md, parte B). O PRAZO não está aqui: é decisão de produto/LGPD e mora em
 * `data_retention_policies` (todas nascem desligadas). Aqui fica só a mecânica de cada tabela:
 *  - `timeColumn`: o instante que conta o prazo;
 *  - `eligible`: o que a linha precisa satisfazer para poder sair (ex.: alerta RESOLVIDO; abertos nunca);
 *  - `children`: tabelas que apontam para esta e SAEM JUNTO (CASCADE de verdade: transcrição e flags da interação). Toda
 *    OUTRA FK que aponta para a linha a PROTEGE — lida do catálogo do PostgreSQL na hora, então uma tabela nova que passe a
 *    referenciar (ex.: evidência de um feedback) protege automaticamente;
 *  - `extraProtection`: referências sem FK (ex.: `evidences.source_id`, `feedbacks.context_snapshot.interactionId`);
 *  - `protectedVia`: a linha herda a proteção da linha-mãe (transcrição de uma interação que é evidência);
 *  - `blockedReason`: bloqueio ESTRUTURAL — a política é recusada mesmo ligada até o bloqueio ser resolvido.
 * SQL com alias `t` para a linha candidata (as proteções extras recebem o alias).
 */
export type RetentionTarget = {
  table: string
  timeColumn: string
  eligible?: string
  children?: string[]
  extraProtection?: ((alias: string) => string)[]
  protectedVia?: { column: string; table: string }
  blockedReason?: string
}

const referencedByEvidence = (alias: string) => `exists (select 1 from evidences e where e.source_id = ${alias}.id::text)`
const INTERACTION_EXTRA_PROTECTION = [referencedByEvidence, (alias: string) => `exists (select 1 from feedbacks f where f.context_snapshot->>'interactionId' = ${alias}.id::text)`]

export const RETENTION_CATALOG: readonly RetentionTarget[] = [
  { table: "transcripts", timeColumn: "created_at", protectedVia: { column: "interaction_id", table: "interactions" } },
  { table: "interactions", timeColumn: "started_at", children: ["transcripts", "interaction_flags"], extraProtection: INTERACTION_EXTRA_PROTECTION },
  {
    // Nome da política. O nome sem sufixo é uma visão, e a tabela real termina em `_all` (migration 174): ao desbloquear, a retenção precisa apontar para ela.
    table: "indicator_measurements",
    timeColumn: "period_start",
    extraProtection: [referencedByEvidence],
    blockedReason: "workflow_enrollments.indicator_measurement_id é ON DELETE CASCADE: apagar a medição apagaria o histórico de execução. Mudar para SET NULL antes.",
  },
  { table: "data_lineage", timeColumn: "created_at" },
  {
    table: "workflow_enrollments",
    timeColumn: "created_at",
    blockedReason: "Decisão pendente: o que acontece com saídas publicadas (feedback, recado) quando a execução que as gerou sai.",
  },
  { table: "ai_usage_events", timeColumn: "occurred_at" },
  { table: "response_compliance_checks", timeColumn: "created_at" },
  { table: "agent_runs", timeColumn: "created_at" },
  { table: "alerts", timeColumn: "created_at", eligible: `t.status = 'RESOLVED'` },
  { table: "audit_logs", timeColumn: "created_at" },
  { table: "assistant_interactions", timeColumn: "occurred_at", children: ["assistant_interaction_support_materials"] },
  { table: "workflow_output_speech_audio", timeColumn: "created_at" },
  { table: "feedback_application_speech_audio", timeColumn: "created_at" },
]

export function retentionTargetOf(table: string): RetentionTarget | null {
  return RETENTION_CATALOG.find((target) => target.table === table) ?? null
}

/** Tamanho do lote: uma transação curta por lote, nunca um DELETE gigante segurando a tabela. */
export const RETENTION_BATCH_SIZE = 5_000
