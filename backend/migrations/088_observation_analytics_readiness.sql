-- V1.7.1j — PRONTIDÃO ANALÍTICA das observações de etapa de processo
--
-- Aditiva: duas colunas novas; nenhuma linha é apagada. "Observação gravada" ≠ "observação confiável para agregação":
--   analytics_status  VERIFIED (prova completa: fala do operador + regra da base, não exemplo + aplicabilidade verificada)
--                     | NEEDS_REVIEW (regra-exemplo, aplicabilidade só literal, omissão não verificada, histórico anterior)
--                     | REJECTED (evidência conflitante);
--   analytics_reasons os motivos (códigos).
-- Só VERIFIED entra em diagnóstico de indicador, histórico e no futuro Chat (isObservationEligibleForAnalytics / eligibleObservationSql).
--
-- Backfill CONSERVADOR: as linhas existentes foram gravadas antes desta prova (não se sabe, pela linha, se a regra era exemplo)
-- — ficam NEEDS_REVIEW com o motivo LEGACY_BEFORE_ANALYTIC_READINESS. Nenhuma é promovida a VERIFIED sem prova.

alter table process_checkpoint_observations
  add column analytics_status text not null default 'NEEDS_REVIEW' check (analytics_status in ('VERIFIED', 'NEEDS_REVIEW', 'REJECTED')),
  add column analytics_reasons text[] not null default '{}';

update process_checkpoint_observations set analytics_reasons = array['LEGACY_BEFORE_ANALYTIC_READINESS'];

create index process_checkpoint_observations_eligible_idx on process_checkpoint_observations (organization_id, practice_key, occurred_at) where analytics_status = 'VERIFIED';
