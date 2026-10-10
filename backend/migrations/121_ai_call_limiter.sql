-- LIMITADOR DE CHAMADAS DE IA — capacidade (model-routing/ai-call-limiter.ts)
--
-- Aditiva: só COLUNAS novas (nulas) em ai_usage_events; nenhuma linha existente muda e o evento continua sendo UM por
-- tentativa de chamada ao provider (sem prompt, sem resposta). O limitador do processo põe cada chamada numa fila com duas
-- classes — INTERACTIVE (chat, voz, request de uma pessoa, QA Lab) e BATCH (execução de Workflow, trabalho de fundo) — e
-- o ponto único de registro de uso (ai-runtime-service.ts › persist) grava o que aconteceu na fila ANTES desta tentativa:
--
--   call_priority          INTERACTIVE | BATCH
--   call_priority_reason   por que a classe (INTERACTIVE_USE_CASE | QA_LAB | USER_REQUEST | WORKFLOW_EXECUTION | BACKGROUND)
--   queue_wait_ms          espera desta tentativa (vaga + pausa do lote + backoff antes de repetir)
--   queue_reason           NONE | CAPACITY (esperou vaga) | PROVIDER_COOLDOWN (lote pausado por 429) | RETRY_BACKOFF
--   limiter_attempt        1 = primeira; 2+ = repetida pelo limitador depois de 429/503 (o fallback da policy continua em
--                          attempt/fallback_index — são contadores diferentes)
--
-- Eventos anteriores a esta migration, "Testar modelo" do admin e scripts sem o limitador ficam com as colunas nulas.
alter table ai_usage_events
  add column call_priority text check (call_priority in ('INTERACTIVE', 'BATCH')),
  add column call_priority_reason text,
  add column queue_wait_ms integer check (queue_wait_ms >= 0),
  add column queue_reason text check (queue_reason in ('NONE', 'CAPACITY', 'PROVIDER_COOLDOWN', 'RETRY_BACKOFF')),
  add column limiter_attempt smallint check (limiter_attempt >= 1);
