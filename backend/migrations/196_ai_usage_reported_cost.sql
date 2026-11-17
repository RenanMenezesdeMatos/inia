-- Custo INFORMADO pelo provedor (16/11/2026).
--
-- Um gateway compatível com OpenAI baseado em LiteLLM informa, no cabeçalho da resposta, o custo da chamada em USD. Quando
-- ele vem (válido), passa a ser o custo registrado do evento, com prioridade sobre a estimativa por tabela:
--   cost_status    = 'REPORTED'  (ao lado de ESTIMATED/UNKNOWN; EXACT continua aceito e nunca é gravado)
--   pricing_source = 'PROVIDER'  (ao lado de TABLE/LEGACY_ENV/NONE)
--   cost/currency  = o valor e a moeda informados; pricing_id fica nulo.
--
-- Só relaxa as checagens para os valores novos: nenhuma linha do histórico é reescrita, e o resumo diário
-- (ai_usage_daily, 138) e o orçamento já somam `cost` sem olhar a origem — o informado conta no orçamento como o estimado.

alter table ai_usage_events drop constraint if exists ai_usage_events_cost_status_check;
alter table ai_usage_events add constraint ai_usage_events_cost_status_check
  check (cost_status in ('EXACT', 'REPORTED', 'ESTIMATED', 'UNKNOWN')) not valid;
alter table ai_usage_events validate constraint ai_usage_events_cost_status_check;

alter table ai_usage_events drop constraint if exists ai_usage_events_pricing_source_check;
alter table ai_usage_events add constraint ai_usage_events_pricing_source_check
  check (pricing_source in ('TABLE', 'LEGACY_ENV', 'PROVIDER', 'NONE')) not valid;
alter table ai_usage_events validate constraint ai_usage_events_pricing_source_check;
