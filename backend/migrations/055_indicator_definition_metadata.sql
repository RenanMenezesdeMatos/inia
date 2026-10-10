-- Catálogo de indicadores como FONTE DE VERDADE do comportamento (metadata-driven). A partir
-- daqui a definição diz à INIA como o indicador se comporta — unidade com contrato, capacidade
-- operacional (daily_supported + operational_aggregation, migration 052), amostra/cobertura mínimas
-- padrão e capacidade de fechamento oficial. Nenhuma coluna por indicador; nenhum dado demo.

-- 1) Unidade deixa de ser texto livre: só o catálogo de unidades que a apresentação sabe
--    formatar (indicators/domain/indicator-definition.ts). COUNT é a contagem genérica; CASES e
--    CASES_PER_DAY continuam pelo legado (Backlog/Produtividade).
alter table indicator_definitions
  add constraint indicator_definitions_unit_check
    check (unit in ('PERCENT', 'SECONDS', 'POINTS', 'STARS', 'COUNT', 'CASES', 'CASES_PER_DAY'));

-- 2) Amostra mínima e cobertura mínima PADRÃO do indicador (metadata do catálogo). O editor de
--    Workflow pré-preenche Condition/Ranking com esses valores ao escolher o indicador — a
--    configuração continua explícita no Workflow (nunca regra silenciosa no runtime).
alter table indicator_definitions
  add column minimum_sample_size integer,
  add column minimum_coverage numeric(4, 3),
  add constraint indicator_definitions_minimum_sample_size_check check (minimum_sample_size is null or minimum_sample_size >= 1),
  add constraint indicator_definitions_minimum_coverage_check check (minimum_coverage is null or (minimum_coverage > 0 and minimum_coverage <= 1));

-- 3) Capacidade OFICIAL: se o indicador pode receber fechamento oficial por competência
--    (employee_indicator_performance — valor, meta, atingimento, quartil e peso, sempre recebidos
--    prontos, nunca calculados aqui). Todos os existentes já têm fechamento → true.
alter table indicator_definitions
  add column official_closure_supported boolean not null default true;

-- 4) Coerência semântica aplicada também no banco: taxa (Σ ocorrências ÷ Σ elegíveis × 100)
--    só faz sentido em percentual.
alter table indicator_definitions
  add constraint indicator_definitions_rate_unit_check
    check (operational_aggregation <> 'RATE' or unit = 'PERCENT');
