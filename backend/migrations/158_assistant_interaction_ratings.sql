-- Curtir/descurtir das respostas da INIA no chat (2026-10-22).
--
-- Os botões "Resposta útil" / "Resposta não foi útil" eram só estado da tela: toda interação com as IAs precisa ficar no banco
-- para que elas possam aprender e ser avaliadas pelo uso real. Mesmo modelo da avaliação do Acompanhamento (migration 113):
--   * Quem avalia é SEMPRE a dona da conversa (a pessoa da sessão) — nunca um id de pessoa vindo do browser — e só respostas da INIA.
--   * HISTÓRICO, nunca sobrescrita: cada clique grava uma linha nova e encerra a anterior (`superseded_at`). A avaliação vigente é a
--     linha sem `superseded_at` (no máximo uma por pessoa × resposta); `NONE` = a pessoa retirou a avaliação.
--   * Sem motivo nem descrição: a tela do chat não pede (diferente do "Este conteúdo foi útil?" do Acompanhamento).
--   * A resposta apagada (retenção) leva a avaliação junto.
create table if not exists assistant_interaction_ratings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  interaction_id uuid not null references assistant_interactions(id) on delete cascade,
  value text not null check (value in ('UP', 'DOWN', 'NONE')),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint assistant_interaction_ratings_superseded_after check (superseded_at is null or superseded_at >= created_at)
);

create unique index if not exists assistant_interaction_ratings_current
  on assistant_interaction_ratings (person_id, interaction_id) where superseded_at is null;
create index if not exists assistant_interaction_ratings_conversation on assistant_interaction_ratings (conversation_id);
create index if not exists assistant_interaction_ratings_organization_created on assistant_interaction_ratings (organization_id, created_at desc);
