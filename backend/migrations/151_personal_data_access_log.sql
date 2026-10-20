-- Registro de LEITURA de dados pessoais de outra pessoa (liberação na Vivo, 2026-10-20 — LGPD).
--
-- `audit_logs` guarda alterações e ações administrativas; até aqui não havia como responder "quem viu os dados desta pessoa e
-- quando". Esta tabela registra quem ABRIU, de outra pessoa: a transcrição de uma chamada (Diagnóstico e QA Lab), uma conversa
-- dela com a INIA (Conversas com a INIA) e a ficha do colaborador. Ler os próprios dados não é registrado.
--
-- Uma linha por pessoa que viu × pessoa vista × tipo de dado × registro a cada 10 minutos (reabrir a mesma tela não enche a
-- tabela). Só leitura do que a tela já autorizou: o registro nunca decide acesso. Retenção: entra no catálogo de retenção
-- (data-lifecycle) quando o prazo for decidido; até lá, fica.

create table personal_data_access_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  viewer_person_id uuid not null references people(id),
  subject_person_id uuid not null references people(id),
  data_kind text not null check (data_kind in ('CALL_TRANSCRIPT', 'ASSISTANT_CONVERSATION', 'EMPLOYEE_PROFILE')),
  resource_id text check (resource_id is null or char_length(resource_id) <= 100),
  accessed_at timestamptz not null default now(),
  check (viewer_person_id <> subject_person_id)
);

-- "Quem viu os dados desta pessoa" e "o que esta pessoa consultou".
create index personal_data_access_log_subject on personal_data_access_log (organization_id, subject_person_id, accessed_at desc);
create index personal_data_access_log_viewer on personal_data_access_log (organization_id, viewer_person_id, accessed_at desc);
