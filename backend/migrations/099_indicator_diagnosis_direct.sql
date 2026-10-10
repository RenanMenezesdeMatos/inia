-- INDICATOR DIAGNOSIS V2 — DIAGNÓSTICO DIRETO DE UM INDICADOR (sem fechamento do PRV)
--
-- Aditiva. A verdade diagnóstica estruturada (`prv_closing_diagnoses`, migration 096) passa a registrar a ORIGEM da execução:
--   PRV_CLOSING       o fechamento do PRV (N indicadores triados) — todas as linhas existentes;
--   DIRECT_INDICATOR  o diagnóstico direto de UM indicador a partir do seu fechamento oficial (contrato OFFICIAL_INDICATOR_PERFORMANCE),
--                     sem ler o PRV. Chave própria (indicador + período + colaborador + versão da estratégia + snapshot oficial).
-- Nenhum dado existente muda de significado; o nome da tabela é histórico.

alter table prv_closing_diagnoses add column source_kind text not null default 'PRV_CLOSING'
  check (source_kind in ('PRV_CLOSING', 'DIRECT_INDICATOR'));
create index prv_closing_diagnoses_source_idx on prv_closing_diagnoses (organization_id, source_kind, person_id, reference_period desc);
