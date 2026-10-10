-- Avaliação do feedback pelo próprio colaborador (2026-10-06): "Este conteúdo foi útil?" no Acompanhamento.
--
-- Curtir/descurtir deixa de ser estado da tela: toda avaliação é persistida para que a INIA (e quem a evolui) aprenda com o
-- uso real. Regras:
--   * Quem avalia é SEMPRE o destinatário do feedback (a pessoa da sessão) — nunca um id de pessoa vindo do browser.
--   * Duas fontes do Acompanhamento com identidades DIFERENTES, as mesmas da aplicação de feedback (migration 103):
--     feedback publicado (`feedbacks`) e feedback de atendimento entregue (`interaction_feedback_deliveries`).
--   * HISTÓRICO, nunca sobrescrita: cada mudança grava uma linha nova e encerra a anterior (`superseded_at`). A avaliação
--     vigente é a linha sem `superseded_at` (no máximo uma por pessoa × fonte); `NONE` = o colaborador retirou a avaliação.
--   * Descurtir exige o MOTIVO (lista fechada) e a descrição do colaborador; curtir/retirar não levam nenhum dos dois.
create table if not exists feedback_ratings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  source_kind text not null check (source_kind in ('PUBLISHED_FEEDBACK', 'INTERACTION_FEEDBACK_DELIVERY')),
  feedback_id uuid references feedbacks(id) on delete cascade,
  interaction_delivery_id uuid references interaction_feedback_deliveries(id) on delete cascade,
  value text not null check (value in ('UP', 'DOWN', 'NONE')),
  reason text check (reason in ('POOR_WRITING', 'WRONG_PROCESS', 'UNCLEAR', 'INIA_COULD_NOT_ANSWER', 'INACCURATE', 'NOT_HELPFUL', 'OTHER')),
  comment text check (comment is null or char_length(comment) between 1 and 1000),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint feedback_ratings_one_source check (
    (source_kind = 'PUBLISHED_FEEDBACK' and feedback_id is not null and interaction_delivery_id is null)
    or (source_kind = 'INTERACTION_FEEDBACK_DELIVERY' and interaction_delivery_id is not null and feedback_id is null)
  ),
  -- Motivo e descrição existem exatamente quando a avaliação é "não foi útil".
  constraint feedback_ratings_down_detail check ((value = 'DOWN') = (reason is not null and comment is not null)),
  constraint feedback_ratings_superseded_after check (superseded_at is null or superseded_at >= created_at)
);

create unique index if not exists feedback_ratings_current_feedback
  on feedback_ratings (person_id, feedback_id) where superseded_at is null and feedback_id is not null;
create unique index if not exists feedback_ratings_current_delivery
  on feedback_ratings (person_id, interaction_delivery_id) where superseded_at is null and interaction_delivery_id is not null;
create index if not exists feedback_ratings_organization_created on feedback_ratings (organization_id, created_at desc);
