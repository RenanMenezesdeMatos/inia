-- Visibilidade de feedback no Acompanhamento — ocultação LÓGICA, explícita e auditável
--
-- Aditiva: uma tabela nova; nenhuma coluna de `feedbacks` muda e nenhuma linha é apagada ou reescrita. Serve para tirar do
-- Acompanhamento (feed do colaborador, visão do gestor, feed da estrutura e contadores derivados) feedbacks que continuam
-- sendo registros legítimos do banco — ex.: publicações das smokes de desenvolvimento da Monitoria por Flag — sem mexer no
-- artefato, no texto publicado, no caso, nas emissões do Workflow ou nos Resultados.
--
-- Seleção sempre EXPLÍCITA: uma linha por feedback, com motivo e o rótulo da seleção (nunca "tudo antes de uma data").
-- Desfazer = `restored_at` (a linha fica no histórico). No máximo uma ocultação vigente por feedback.

create table feedback_follow_up_hides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  feedback_id uuid not null references feedbacks(id),
  reason_code text not null check (reason_code in ('DEVELOPMENT_ARTIFACT')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  selection_ref text not null check (selection_ref ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  hidden_by uuid references people(id),
  hidden_at timestamptz not null,
  restored_by uuid references people(id),
  restored_at timestamptz,
  restore_reason text check (restore_reason is null or length(btrim(restore_reason)) between 1 and 500),
  check (restored_at is not null or (restored_by is null and restore_reason is null)),
  check (restored_at is null or restore_reason is not null)
);

create unique index feedback_follow_up_hides_active_idx on feedback_follow_up_hides (feedback_id) where restored_at is null;
create index feedback_follow_up_hides_selection_idx on feedback_follow_up_hides (organization_id, selection_ref);
