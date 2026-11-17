-- Auditoria de 16/11/2026 (rodada 4) — índices do Apoio com Anjo e do universo de atuação, e a versão monotônica dos tempos por Grupo.
-- Idempotente (`if not exists` / `if exists`). Ver docs/dev/memoria/banco-e-consultas.md e apoio-com-anjo.md.
-- Nenhuma destas tabelas é visão sobre `<nome>_all` (migrations 174/175/177): os índices vão na própria tabela.

-- M1. Atendimentos de um pedido (`exists ... where a.request_id = r.id` nas listas e números do painel, o primeiro atendimento do
--     pedido na Jornada e a lista do detalhe em ordem de início). Só havia o índice parcial dos ATIVOS. As leituras de mensagens por
--     atendimento passaram a filtrar também `m.request_id` e usam o índice único (request_id, seq) que já existe.
create index if not exists human_support_attendances_request on human_support_attendances (request_id, started_at, id);

-- M2. Primeira classificação de uma pessoa (trigger `track_person_operating_universe`, migration 197): carimba os casos dela ainda
--     sem universo. Sem índice em `operator_id`, cada classificação lia todos os casos da tabela.
create index if not exists supervision_cases_operator_pending_universe on supervision_cases (operator_id) where operating_universe is null;

-- B1. Duplicado: `human_support_requests_org_created` (191) é idêntico a `human_support_requests_created` (182), ambos
--     (organization_id, created_at). Fica o da 182.
drop index if exists human_support_requests_org_created;

-- B2. "Anjo sem responder ninguém" (distribuição, passo 4c): o ramo dos atendimentos perdidos por falta de resposta nas últimas horas.
--     A consulta virou dois ramos com UNION ALL; o ramo dos ATIVOS usa `human_support_attendances_open`.
create index if not exists human_support_attendances_anjo_silent on human_support_attendances (organization_id, ended_at) where end_cause = 'ANJO_SILENT';

-- B3. Última causa de conexão do Anjo (distribuição, passo 3): agora ordenada por (occurred_at, id), na ordem do índice
--     `human_support_presence_events_person` (organization_id, person_id, occurred_at) — nada a criar.

-- B4. Tempos de resposta por Grupo: "Usar o padrão" não apaga mais a linha (a versão otimista voltava a 0 e uma edição concorrente
--     passava sem 409). A linha fica com `custom = false` e a versão continua subindo. Linhas existentes são tempos próprios.
alter table human_support_group_response_times add column if not exists custom boolean not null default true;
