-- SUBMOTIVO da interação (2026-10-16).
--
-- `interactions.reason` é o MOTIVO, a categoria mais genérica que a fonte cadastra (ex.: "Fatura"). O
-- submotivo é o recorte específico DENTRO do motivo (ex.: "Segunda via", "Dúvida sobre faturamento").
-- Os dois vêm da fonte como estão: nunca são derivados, reescritos ou classificados por IA.
--
-- Opcional e sempre nulo por padrão: cargas antigas (contrato INTERACTIONS@1, ingestão legada) não têm
-- submotivo, e dado ausente não é motivo "sem submotivo". Nenhuma linha existente é alterada aqui.
--
-- Índice para o recorte "motivo → submotivo no período" da organização (diagnóstico da liderança: os
-- principais motivos/submotivos de quem está pior num indicador). O índice antigo
-- `idx_interactions_reason_started` continua servindo "motivo no período" ordenado por início.

alter table interactions add column sub_reason text;

create index idx_interactions_reason_sub_reason_started on interactions (organization_id, reason, sub_reason, started_at desc);
