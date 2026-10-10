-- INDICATOR DIAGNOSIS V1 — DIAGNÓSTICO DO FECHAMENTO OFICIAL DO PRV
--
-- Aditiva. Nada existente muda de significado; nenhuma linha oficial (employee_prv_performance / employee_indicator_performance)
-- é tocada — os valores oficiais continuam soberanos e só são LIDOS.
--
--   prv_closing_diagnoses                  a VERDADE DIAGNÓSTICA ESTRUTURADA de um fechamento (triagem + investigações por indicador +
--                                          versões) — uma linha por chave de idempotência (fechamento × versões das estratégias ×
--                                          versão lógica). Mesmo fechamento + mesma estratégia + mesma lógica = nunca um segundo
--                                          diagnóstico/publicação. Gravada na MESMA transação do artefato confiável que a produziu.
--   reliable_feedback_artifacts.prv_closing_key
--                                          o feedback de indicador nascido de um FECHAMENTO não tem medição diária: a chave do
--                                          diagnóstico é a identidade do sujeito (a regra "INDICATOR exige medição" passa a aceitar
--                                          medição OU fechamento).
--   process_checkpoint_observations.display_context
--                                          o que torna a observação REAPROVEITÁVEL como evidência num diagnóstico futuro: até 2 falas do
--                                          operador já projetadas para exibição (display-safe), a regra oficial literal e a orientação
--                                          oficial. Nulo nas observações anteriores (reuso continua possível; só sem exemplo exibível).

create table prv_closing_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  reference_period text not null check (reference_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  idempotency_key text not null check (char_length(idempotency_key) between 10 and 200),
  logic_version text not null,
  -- Versão da estratégia usada por indicador: [{ indicatorCode, strategyVersionId }].
  strategy_versions jsonb not null default '[]'::jsonb,
  -- Linhas oficiais lidas (ids + valores como vieram), para "com quais dados esta conclusão foi feita?".
  closing jsonb not null,
  diagnosis jsonb not null,
  source_artifact_id uuid references reliable_feedback_artifacts(id) on delete set null,
  enrollment_id uuid,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index prv_closing_diagnoses_person_idx on prv_closing_diagnoses (organization_id, person_id, reference_period desc);

alter table reliable_feedback_artifacts add column prv_closing_key text check (prv_closing_key is null or char_length(prv_closing_key) between 10 and 200);
-- A regra antiga é uma check sem nome (083): localizada pela definição, não pelo nome gerado.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'reliable_feedback_artifacts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%domain <> ''INDICATOR''%indicator_measurement_id IS NOT NULL%'
  loop
    execute format('alter table reliable_feedback_artifacts drop constraint %I', constraint_name);
  end loop;
end $$;
alter table reliable_feedback_artifacts
  add constraint reliable_feedback_artifacts_indicator_subject_check
  check (domain <> 'INDICATOR' or indicator_measurement_id is not null or prv_closing_key is not null);

alter table process_checkpoint_observations add column display_context jsonb;
