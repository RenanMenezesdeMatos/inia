-- Registro genérico de saída de um node Output para superfícies que ainda não têm uma tabela
-- dedicada (AVATAR/CHAT/INBOX/CUSTOM_SURFACE) — FOLLOW_UP pro próprio operador continua indo
-- para feedbacks/supervision_cases; FOLLOW_UP/NOTIFICATION pra outro destinatário reaproveita
-- a tabela alerts já usada pelo ESCALATE. Nenhuma dessas duas precisa desta tabela.
create table workflow_outputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  enrollment_id uuid not null references workflow_enrollments(id) on delete cascade,
  node_id text not null,
  recipient_id uuid not null references people(id),
  surface text not null check (surface in ('AVATAR', 'CHAT', 'INBOX', 'CUSTOM_SURFACE')),
  interaction_mode text not null default 'PROMPT' check (interaction_mode in ('PASSIVE', 'PROMPT', 'IMMEDIATE')),
  content jsonb,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_workflow_outputs_recipient_pending on workflow_outputs (recipient_id, created_at desc) where delivered_at is null;
