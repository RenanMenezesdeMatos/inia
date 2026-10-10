-- Severidades separadas na carga: error_count = erros reais (registros rejeitados / falha);
-- warning_count = avisos não bloqueantes (ex.: conflito de situação funcional resolvido pela
-- precedência — o registro FOI aplicado). Histórico sem a coluna fica 0 (nunca reclassificado).
alter table data_ingestion_runs
  add column if not exists warning_count integer not null default 0;
