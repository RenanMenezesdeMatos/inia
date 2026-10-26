-- BOAS PRÁTICAS PELO SINAL DA CHAMADA (2026-10-22, BEST_PRACTICE_ANALYSIS_V3). Além do indicador (melhores = 1º quartil oficial,
-- por operador), a análise pode medir "os melhores" pelo SINAL que vem em cada chamada (ex.: nota da URA): chamadas com resultado
-- bom × chamadas com resultado ruim, no mesmo contexto e população. Nada é suposto sobre o sinal: o que é bom e ruim é CADASTRO.
--
--   channel_flags.call_outcome                    o que é chamada boa/ruim no sinal. Numérico: {"kind":"NUMERIC","good":{operator,value},
--                                                 "bad":{operator,value}} (o meio fica de fora). Sim/não: {"kind":"BOOLEAN","badValue":true}
--                                                 (o valor oposto, enviado explicitamente, é o bom). Chamada SEM o sinal nunca é boa nem
--                                                 ruim (dado ausente não é resultado). Nulo = o sinal não serve para comparar chamadas.
--   channel_flags.related_indicator_definition_id indicador relacionado (ex.: rechamada → indicador Rechamada): no feedback disparado
--                                                 pelo sinal, sem prática do próprio sinal, vêm as do indicador.
--   best_practice_analyses / best_practice_patterns.channel_flag_id
--                                                 o resultado medido é o sinal; o indicador fica nulo (exatamente um dos dois).
--   best_practice_analyses.call_outcome           cópia do critério do sinal no pedido (a análise é reproduzível mesmo que o cadastro mude).
-- Ver docs/dev/memoria/boas-praticas.md.

alter table channel_flags add column call_outcome jsonb;
alter table channel_flags add constraint channel_flags_call_outcome_kind check (call_outcome is null or call_outcome->>'kind' in ('NUMERIC', 'BOOLEAN'));
alter table channel_flags add column related_indicator_definition_id uuid references indicator_definitions(id) on delete set null;

alter table best_practice_analyses alter column indicator_definition_id drop not null;
alter table best_practice_analyses add column channel_flag_id uuid references channel_flags(id) on delete cascade;
alter table best_practice_analyses add column call_outcome jsonb;
alter table best_practice_analyses add constraint best_practice_analyses_outcome_one check (num_nonnulls(indicator_definition_id, channel_flag_id) = 1);
alter table best_practice_analyses add constraint best_practice_analyses_signal_outcome check (channel_flag_id is null or call_outcome is not null);

alter table best_practice_patterns alter column indicator_definition_id drop not null;
alter table best_practice_patterns add column channel_flag_id uuid references channel_flags(id) on delete cascade;
alter table best_practice_patterns add constraint best_practice_patterns_outcome_one check (num_nonnulls(indicator_definition_id, channel_flag_id) = 1);

create index idx_best_practice_patterns_signal on best_practice_patterns (organization_id, channel_flag_id, review_status) where channel_flag_id is not null;

-- Comparação pelo sinal: chamadas boas × chamadas ruins (o quartil não se aplica).
alter table best_practice_analyses drop constraint best_practice_analyses_comparison_check;
alter table best_practice_analyses add constraint best_practice_analyses_comparison_check check (comparison in ('TOP_QUARTILE_VS_REST', 'TOP_VS_BOTTOM_QUARTILE', 'GOOD_VS_BAD_CALLS'));
alter table best_practice_analyses add constraint best_practice_analyses_signal_comparison check ((channel_flag_id is not null) = (comparison = 'GOOD_VS_BAD_CALLS'));
