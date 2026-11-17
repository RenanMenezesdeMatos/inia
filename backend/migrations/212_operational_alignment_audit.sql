-- ALINHAMENTOS OPERACIONAIS — RASTRO DE AUDITORIA (17/11/2026, pedido do usuário). Guardado para auditoria, sem tela.
--
-- `operational_alignment_events`: tudo o que acontece com um alinhamento, com quem fez e quando — criação, rascunho salvo (com os
-- campos alterados e os processos incluídos/excluídos), rascunho descartado, publicação, versão substituída, início da vigência,
-- expiração (gravada pelo job `operational-alignments-lifecycle`), encerramento antecipado, cancelamento, exclusão, restauração e
-- reprocessamento. Só inserção: nada aqui é alterado nem apagado pela aplicação.
--
-- `operational_alignment_usages`: QUAL VERSÃO a IA leu, onde e quando — cada montagem de instruções do chat/voz/agente e cada análise
-- de chamada da monitoria em que o alinhamento entrou, com a data de referência usada pela regra.
--
-- Exclusão lógica: a coluna `deleted_by` (209) passa a `deleted_by_person_id`, o nome que "Consultar dados › Itens excluídos" usa.

alter table operational_alignments rename column deleted_by to deleted_by_person_id;

create table if not exists operational_alignment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  alignment_id uuid not null references operational_alignments(id),
  version_id uuid references operational_alignment_versions(id) on delete set null,
  version integer,
  event_type text not null check (event_type in (
    'CREATED', 'DRAFT_SAVED', 'DRAFT_DISCARDED', 'PUBLISHED', 'SUPERSEDED', 'STARTED', 'EXPIRED', 'ENDED', 'CANCELLED', 'DELETED', 'RESTORED', 'REPROCESSED'
  )),
  -- Pessoa que fez; nulo = o sistema (início/expiração pelo relógio) ou restauração registrada pela consulta de itens excluídos.
  actor_person_id uuid references people(id),
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index if not exists operational_alignment_events_alignment on operational_alignment_events (organization_id, alignment_id, occurred_at);
-- Início e expiração gravados uma vez por versão (o job pode rodar em vários processos).
create unique index if not exists operational_alignment_events_clock_once on operational_alignment_events (version_id, event_type) where event_type in ('STARTED', 'EXPIRED');

create table if not exists operational_alignment_usages (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  alignment_id uuid not null references operational_alignments(id),
  version_id uuid not null references operational_alignment_versions(id),
  -- CONVERSATION (chat/voz), AGENT (execução de agente/Workflow), MONITORING (análise de chamada do motor de feedback).
  surface text not null check (surface in ('CONVERSATION', 'AGENT', 'MONITORING')),
  person_id uuid references people(id),
  agent_id uuid,
  interaction_id uuid,
  reference_date timestamptz not null,
  used_at timestamptz not null default now()
);
create index if not exists operational_alignment_usages_version on operational_alignment_usages (organization_id, version_id, used_at);
