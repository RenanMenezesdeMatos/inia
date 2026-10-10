-- Conversas com a INIA (2026-09-29).
--
-- Antes: assistant_interactions era um histórico CONTÍNUO por operador (sem conversa). Agora cada mensagem
-- pertence a uma CONVERSA persistida, com dono, organização, datas, estado e encerramento. A sessão técnica
-- de voz (conexão Gemini Live) NÃO é conversa: uma conversa pode ter texto e várias conexões de voz.
--
-- Regras aplicadas pelo backend (assistant/application/assistant-conversations.ts), não pelo banco:
--   * conversa só nasce na primeira mensagem (nunca vazia);
--   * inatividade (INIA_CONVERSATION_INACTIVITY_HOURS, padrão 24 h) → a PRÓXIMA mensagem abre outra;
--   * "Nova conversa" encerra a ativa (MANUAL) sem criar nada.
-- O banco garante: no máximo UMA conversa ativa por dono (índice parcial) e mensagens ligadas à conversa.

create table if not exists assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  owner_person_id uuid not null references people(id),
  -- CONVERSATION = conversa real; LEGACY_HISTORY = registros anteriores a esta migration, cujos limites de
  -- conversa não são conhecidos (apresentados como "Histórico anterior", nunca divididos por suposição).
  kind text not null default 'CONVERSATION' check (kind in ('CONVERSATION', 'LEGACY_HISTORY')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  closed_at timestamptz,
  close_reason text check (close_reason in ('MANUAL', 'INACTIVITY', 'LEGACY')),
  created_at timestamptz not null default now(),
  constraint assistant_conversations_closed_consistency check (
    (status = 'ACTIVE' and closed_at is null and close_reason is null)
    or (status = 'CLOSED' and closed_at is not null and close_reason is not null)
  ),
  constraint assistant_conversations_legacy_closed check (kind <> 'LEGACY_HISTORY' or status = 'CLOSED')
);

create unique index if not exists uq_assistant_conversations_one_active
  on assistant_conversations (organization_id, owner_person_id) where status = 'ACTIVE';
create index if not exists idx_assistant_conversations_owner_activity
  on assistant_conversations (organization_id, owner_person_id, last_activity_at desc, id desc);
create index if not exists idx_assistant_conversations_org_activity
  on assistant_conversations (organization_id, last_activity_at desc, id desc);

comment on table assistant_conversations is 'Conversa persistida com a INIA (chat + voz). Sessão de voz ≠ conversa.';

-- Mensagens: conversa, instante em que aconteceu (occurred_at — a fala do usuário na voz é transcrita antes da
-- resposta do especialista, mas chega ao backend depois; a ordem de leitura é a do acontecimento), sequência
-- estável para desempate/paginação e chave idempotente do cliente (retentativas não duplicam).
alter table assistant_interactions add column if not exists conversation_id uuid references assistant_conversations(id);
alter table assistant_interactions add column if not exists occurred_at timestamptz;
alter table assistant_interactions add column if not exists seq bigint generated always as identity;
alter table assistant_interactions add column if not exists client_message_id text;

update assistant_interactions set occurred_at = created_at where occurred_at is null;
alter table assistant_interactions alter column occurred_at set default now();
alter table assistant_interactions alter column occurred_at set not null;

-- Backfill seguro: UM "Histórico anterior" por dono com registros, encerrado, com as datas reais do primeiro e
-- do último registro. Nenhuma mensagem é criada, alterada ou dividida.
insert into assistant_conversations (organization_id, owner_person_id, kind, status, started_at, last_activity_at, closed_at, close_reason)
select organization_id, operator_id, 'LEGACY_HISTORY', 'CLOSED', min(created_at), max(created_at), max(created_at), 'LEGACY'
from assistant_interactions
where conversation_id is null
group by organization_id, operator_id;

update assistant_interactions i
set conversation_id = c.id
from assistant_conversations c
where i.conversation_id is null
  and c.kind = 'LEGACY_HISTORY'
  and c.organization_id = i.organization_id
  and c.owner_person_id = i.operator_id;

alter table assistant_interactions alter column conversation_id set not null;

create index if not exists idx_assistant_interactions_conversation_order
  on assistant_interactions (conversation_id, occurred_at, seq);
create unique index if not exists uq_assistant_interactions_client_message
  on assistant_interactions (conversation_id, client_message_id) where client_message_id is not null;
