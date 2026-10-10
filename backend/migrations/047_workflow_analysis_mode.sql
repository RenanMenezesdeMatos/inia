-- Refatoração de "Unidade de Análise" (migration 045) em dois conceitos separados: Modo de
-- avaliação (derivado — Consolidado quando consolidated_structure não é nulo, Individual caso
-- contrário, mesma convenção "ausente = padrão" já usada em todo o motor) e Filtro populacional
-- (quem entra na população elegível, só existe em modo Individual). Renomeio a coluna em vez de
-- reaproveitar o nome antigo com significado novo — é exatamente essa confusão de nomenclatura
-- que motivou a refatoração (unit_of_analysis vinha respondendo "individual ou agregado?" e "qual
-- estrutura?" ao mesmo tempo).
alter table workflows rename column unit_of_analysis to consolidated_structure;
alter table workflows add column population_filter jsonb;

-- A variante OPERATOR deixa de existir no schema de consolidated_structure (não fazia sentido
-- como "estrutura consolidada" — já era o sinônimo de "ausente"). Backfill idempotente: nenhum
-- dado real se perde, {"kind":"OPERATOR"} e NULL já eram equivalentes.
update workflows set consolidated_structure = null where consolidated_structure ->> 'kind' = 'OPERATOR';
