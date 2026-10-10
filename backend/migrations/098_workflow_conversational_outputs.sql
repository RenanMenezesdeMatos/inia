-- Workflow Outputs V1 — CHAT e AVATAR com consumidor real (2026-09-29).
--
-- `workflow_outputs` (migration 032) já era o registro genérico das saídas de um nó Output para superfícies sem tabela
-- própria (AVATAR/CHAT/INBOX/CUSTOM_SURFACE) — só era gravado, ninguém lia. Esta migration o transforma no registro de
-- ENTREGA dessas superfícies, sem criar um sistema paralelo:
--   * idempotência: no máximo UMA linha por matrícula × nó Output × superfície × destinatário (retry do motor, duas
--     instâncias e reprocessamento nunca criam duas conversas nem dois convites);
--   * projeção por superfície (título, texto do chat, fala do avatar, texto exibível) derivada do MESMO conteúdo confiável
--     que o Acompanhamento publica — nunca uma segunda análise;
--   * ciclo de vida da entrega de VOZ: PENDING → OFFERED → ACCEPTED → PLAYING → DELIVERED (+ SNOOZED, FAILED, INTERRUPTED).
--     ACEITAR não é ENTREGAR: `delivered_at` só é gravado quando a fala terminou. CHAT nasce DELIVERED (conversa + mensagem
--     persistidas para o destinatário); "lida" é outra coisa (`assistant_conversations.owner_seen_at`).
-- A tabela estava vazia em todos os ambientes conhecidos; a unique é criada sem limpeza.

alter table workflow_outputs add column if not exists artifact_id uuid references reliable_feedback_artifacts(id);
alter table workflow_outputs add column if not exists title text;
alter table workflow_outputs add column if not exists display_text text;
alter table workflow_outputs add column if not exists speech_text text;
alter table workflow_outputs add column if not exists projection_version text;
alter table workflow_outputs add column if not exists delivery_status text not null default 'PENDING';
alter table workflow_outputs add column if not exists offered_at timestamptz;
alter table workflow_outputs add column if not exists accepted_at timestamptz;
alter table workflow_outputs add column if not exists playing_at timestamptz;
alter table workflow_outputs add column if not exists snoozed_at timestamptz;
alter table workflow_outputs add column if not exists failed_at timestamptz;
alter table workflow_outputs add column if not exists failure_reason text;
alter table workflow_outputs add column if not exists attempt_count integer not null default 0;
alter table workflow_outputs add column if not exists updated_at timestamptz not null default now();

alter table workflow_outputs drop constraint if exists workflow_outputs_delivery_status_check;
alter table workflow_outputs add constraint workflow_outputs_delivery_status_check
  check (delivery_status in ('PENDING', 'OFFERED', 'ACCEPTED', 'PLAYING', 'DELIVERED', 'SNOOZED', 'FAILED', 'INTERRUPTED'));
-- Entregue ⇔ delivered_at (nunca "entregue" sem o instante, nem instante sem o estado).
alter table workflow_outputs drop constraint if exists workflow_outputs_delivered_consistency;
alter table workflow_outputs add constraint workflow_outputs_delivered_consistency
  check ((delivery_status = 'DELIVERED') = (delivered_at is not null));
-- Voz só é DELIVERED depois de ter começado a tocar e de ter sido aceita.
alter table workflow_outputs drop constraint if exists workflow_outputs_avatar_delivered_after_play;
alter table workflow_outputs add constraint workflow_outputs_avatar_delivered_after_play
  check (surface <> 'AVATAR' or delivery_status <> 'DELIVERED' or (accepted_at is not null and playing_at is not null));

create unique index if not exists uq_workflow_outputs_emission on workflow_outputs (enrollment_id, node_id, surface, recipient_id);
create index if not exists idx_workflow_outputs_avatar_inbox
  on workflow_outputs (organization_id, recipient_id, created_at desc)
  where surface = 'AVATAR' and delivery_status <> 'DELIVERED';

-- Conversa criada por um Workflow: origem, título e "não lida". Não disputa a conversa ATUAL do usuário: a regra "no máximo
-- uma conversa ativa por dono" passa a valer só para conversas iniciadas pelo usuário (origin = USER).
alter table assistant_conversations add column if not exists origin text not null default 'USER';
alter table assistant_conversations drop constraint if exists assistant_conversations_origin_check;
alter table assistant_conversations add constraint assistant_conversations_origin_check check (origin in ('USER', 'WORKFLOW'));
alter table assistant_conversations drop constraint if exists assistant_conversations_workflow_is_conversation;
alter table assistant_conversations add constraint assistant_conversations_workflow_is_conversation check (origin <> 'WORKFLOW' or kind = 'CONVERSATION');
alter table assistant_conversations add column if not exists title text;
-- Primeira abertura pelo dono (só significa algo para conversas de Workflow: nascem não lidas).
alter table assistant_conversations add column if not exists owner_seen_at timestamptz;

drop index if exists uq_assistant_conversations_one_active;
create unique index if not exists uq_assistant_conversations_one_active
  on assistant_conversations (organization_id, owner_person_id) where status = 'ACTIVE' and origin = 'USER';
create index if not exists idx_assistant_conversations_workflow_unread
  on assistant_conversations (organization_id, owner_person_id) where origin = 'WORKFLOW' and owner_seen_at is null;

-- A entrega CHAT aponta para a conversa que criou (proveniência: matrícula → Workflow/versão, nó, destinatário, artefato).
alter table workflow_outputs add column if not exists conversation_id uuid references assistant_conversations(id);
create unique index if not exists uq_workflow_outputs_conversation on workflow_outputs (conversation_id) where conversation_id is not null;
