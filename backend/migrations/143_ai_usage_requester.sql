-- QUEM PEDIU a chamada de IA — base do ranking "Quem mais usa" (Administração › IA / Modelos).
--
-- Aditiva: só uma COLUNA nova (nula) em ai_usage_events; nenhuma linha existente muda e o evento continua sendo UM por
-- tentativa de chamada ao provider (sem prompt, sem resposta). `requester_person_id` = a PESSOA DA SESSÃO do request HTTP que
-- fez a chamada: o middleware de auth já abria o contexto assíncrono da IA com a organização da sessão verificada; agora leva
-- também a pessoa, e o ponto único de registro de uso (ai-runtime-service.ts › persist) grava a coluna. Nunca vem do corpo,
-- da URL, de horário, texto ou nome.
--
-- Fora de um request (motor de Workflow, jobs, scripts) fica nula. O uso de Workflow continua atribuído pelo colaborador da
-- MATRÍCULA (`enrollment_id`, migration 084) — o ranking resolve matrícula → colaborador na leitura, sem copiar aqui.
-- Eventos anteriores a esta migration ficam sem pessoa: o ranking os mostra como "Sem vínculo", nunca os atribui a alguém.
--
-- Sem FK de propósito (livro-razão, como workflow_id/enrollment_id): apagar uma pessoa não apaga nem invalida o consumo.
-- Sem índice: o ranking lê pelo índice de organização × tempo (ai_usage_events_org_time_idx) e agrupa no período.
alter table ai_usage_events
  add column requester_person_id uuid;
