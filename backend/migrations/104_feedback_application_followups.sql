-- Conversa COMPLEMENTAR de uma aplicação de feedback concluída (2026-10-01).
--
-- Concluir a aplicação encerra a aplicação e a sua conversa original (somente consulta). Dúvidas que aparecem depois ficam numa
-- conversa complementar, vinculada à MESMA aplicação e ao MESMO contexto histórico congelado — nunca na conversa original
-- (que continua encerrada) e nunca na conversa geral (que não conhece o registro). A conversa complementar:
--   * não reaplica o feedback, não reabre a aplicação, não confirma ciência e não reabre caso de supervisão;
--   * só nasce quando o colaborador envia a primeira dúvida (ou o primeiro turno de voz) — abrir o feedback não cria nada;
--   * é reaproveitada enquanto estiver ativa (no máximo uma ativa por aplicação, garantido por lock transacional no backend);
--   * é uma conversa comum (`assistant_conversations`, origem FEEDBACK): mensagens, voz e histórico são os de sempre.
-- O vínculo conversa → aplicação é decidido pelo backend (dono + organização + aplicação concluída); o navegador nunca escolhe.
create table if not exists feedback_application_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  application_id uuid not null references feedback_applications(id) on delete cascade,
  recipient_person_id uuid not null references people(id),
  conversation_id uuid not null unique references assistant_conversations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_application_followups_application on feedback_application_followups (application_id, created_at desc);

comment on table feedback_application_followups is 'Conversa complementar (dúvidas após a conclusão) de uma aplicação de feedback — mesma aplicação, mesmo contexto histórico.';
