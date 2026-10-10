-- Aplicação de feedback conversacional (2026-10-01).
--
-- "Aplicação" = a INIA apresentar ao colaborador UM feedback já publicado e conversar com ele sobre esse feedback. Regra
-- central: cada feedback tem UMA aplicação, ligada ao feedback de origem e ao próprio destinatário. Enquanto não concluída
-- ela é retomada (mesma conversa, várias perguntas); concluída, fica só para consulta e nunca é reaplicada.
--
--   * Estado da APLICAÇÃO (NOT_STARTED → IN_PROGRESS → COMPLETED) ≠ estado da REPRODUÇÃO do áudio (fatos em
--     presentation_*: começou, terminou, foi interrompida) ≠ CIÊNCIA (feedbacks.acknowledged_at /
--     interaction_feedback_deliveries.acknowledged_at, que esta tabela nunca toca). Ouvir, conversar ou concluir não
--     confirma ciência nem encerra caso de supervisão.
--   * Duas fontes do Acompanhamento com identidades DIFERENTES: feedback publicado (`feedbacks`) e feedback de atendimento
--     entregue (`interaction_feedback_deliveries`). Exatamente uma referência por linha; unique por fonte — clique repetido,
--     retentativa, recarregar ou outra aba sempre recuperam a MESMA aplicação.
--   * `context`: cópia do REGISTRO PUBLICADO (conteúdo, versão, assunto, período, indicadores/valores/metas registrados,
--     atendimento/caso, evidências, orientações, materiais) feita na primeira aplicação, com proveniência. Nada atual é
--     consultado para montá-la; o que o registro não guarda vira limitação declarada. Congelada: retomadas, voz e perguntas
--     posteriores usam a MESMA versão, mesmo que a apresentação visual do feedback seja reprojetada depois.
--   * Convite proativo (um por vez, só feedbacks novos): `invite_*`. Ação do colaborador encerra o convite para sempre.
create table if not exists feedback_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  recipient_person_id uuid not null references people(id),
  source_kind text not null check (source_kind in ('PUBLISHED_FEEDBACK', 'INTERACTION_FEEDBACK_DELIVERY')),
  feedback_id uuid references feedbacks(id),
  interaction_delivery_id uuid references interaction_feedback_deliveries(id),
  -- Versão do feedback publicado quando a aplicação começou (correção formal publicada depois NÃO reaplica — ver doc).
  source_version integer,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
  conversation_id uuid unique references assistant_conversations(id),
  context jsonb,
  context_version text,
  presentation jsonb,
  presentation_version text,
  started_at timestamptz,
  last_opened_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  -- Reprodução do áudio da apresentação: só FATOS (não decidem conclusão).
  presentation_started_at timestamptz,
  presentation_completed_at timestamptz,
  presentation_interrupted_at timestamptz,
  presentation_play_count integer not null default 0 check (presentation_play_count >= 0),
  -- Convite proativo.
  invite_offered_at timestamptz,
  invite_resolved_at timestamptz,
  invite_resolution text check (invite_resolution in ('ACCEPTED', 'READ', 'SNOOZED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_applications_one_source check (
    (source_kind = 'PUBLISHED_FEEDBACK' and feedback_id is not null and interaction_delivery_id is null)
    or (source_kind = 'INTERACTION_FEEDBACK_DELIVERY' and interaction_delivery_id is not null and feedback_id is null)
  ),
  -- Iniciada/concluída ⇒ conversa, contexto e apresentação existem; não iniciada ⇒ nada disso.
  constraint feedback_applications_started_consistency check (
    (status = 'NOT_STARTED' and conversation_id is null and started_at is null and context is null)
    or (status <> 'NOT_STARTED' and conversation_id is not null and started_at is not null and context is not null and presentation is not null)
  ),
  constraint feedback_applications_completed_consistency check ((status = 'COMPLETED') = (completed_at is not null)),
  constraint feedback_applications_invite_consistency check ((invite_resolved_at is null) = (invite_resolution is null))
);

create unique index if not exists uq_feedback_applications_feedback on feedback_applications (organization_id, feedback_id) where feedback_id is not null;
create unique index if not exists uq_feedback_applications_interaction_delivery on feedback_applications (organization_id, interaction_delivery_id) where interaction_delivery_id is not null;
create index if not exists idx_feedback_applications_recipient on feedback_applications (organization_id, recipient_person_id, updated_at desc);

comment on table feedback_applications is 'Aplicação conversacional de UM feedback publicado ao próprio destinatário (uma por feedback; retomável até concluída).';

-- Voz da apresentação (mesma voz/verificação do recado): gerada uma vez por texto; regenerar o áudio nunca cria aplicação.
create table if not exists feedback_application_speech_audio (
  application_id uuid primary key references feedback_applications(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  text_sha256 text not null,
  voice_name text not null,
  model text not null,
  sample_rate integer not null check (sample_rate between 8000 and 48000),
  audio bytea not null,
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

-- Conversa da aplicação: origem FEEDBACK (nunca disputa a conversa "atual" do usuário, nunca expira por inatividade) e
-- encerramento explícito pela conclusão da aplicação (COMPLETED).
alter table assistant_conversations drop constraint if exists assistant_conversations_origin_check;
alter table assistant_conversations add constraint assistant_conversations_origin_check check (origin in ('USER', 'WORKFLOW', 'FEEDBACK'));
alter table assistant_conversations drop constraint if exists assistant_conversations_workflow_is_conversation;
alter table assistant_conversations add constraint assistant_conversations_workflow_is_conversation check (origin = 'USER' or kind = 'CONVERSATION');
alter table assistant_conversations drop constraint if exists assistant_conversations_close_reason_check;
alter table assistant_conversations add constraint assistant_conversations_close_reason_check check (close_reason in ('MANUAL', 'INACTIVITY', 'LEGACY', 'COMPLETED'));
