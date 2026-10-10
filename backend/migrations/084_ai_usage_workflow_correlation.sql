-- V1.5.13 — WORKFLOW RESULTS & AI USAGE OBSERVABILITY
--
-- Aditiva: só COLUNAS novas (nulas) em ai_usage_events; nenhuma linha existente muda. Correlação DETERMINÍSTICA de cada
-- tentativa de chamada de IA com a execução de Workflow que a fez:
--
--   uso → organização → workflow → versão → disparo (matrícula RAIZ) → matrícula → nó
--
-- Preenchida pelo próprio runtime: o motor processa UM nó de UMA matrícula dentro do contexto assíncrono que já carregava a
-- organização (engine.ts › processEnrollment); esse contexto passou a carregar também workflow/versão/matrícula/raiz/nó, e o
-- ponto único de registro de uso (ai-runtime-service.ts › persist) grava essas colunas. Nunca por horário, texto ou nome.
-- O sujeito (colaborador) vem da MATRÍCULA (interação/medição/agenda), não é duplicado aqui.
--
-- Sem FK de propósito: ai_usage_events é um livro-razão de consumo — apagar um Workflow (cascade das matrículas) não pode
-- apagar nem invalidar o registro do que foi consumido. Eventos anteriores a esta migration ficam sem correlação (N/D).
alter table ai_usage_events
  add column workflow_id uuid,
  add column workflow_version_id uuid,
  add column enrollment_id uuid,
  add column root_enrollment_id uuid,
  add column workflow_node_id text;

create index ai_usage_events_root_enrollment_idx on ai_usage_events (organization_id, root_enrollment_id) where root_enrollment_id is not null;
create index ai_usage_events_workflow_idx on ai_usage_events (organization_id, workflow_id, occurred_at) where workflow_id is not null;
