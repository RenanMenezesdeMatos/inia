-- Revisão das contestações de feedback (liberação na Vivo, 2026-10-20 — LGPD art. 20).
--
-- O colaborador já registra quando um feedback gerado pela INIA "não foi útil", com o motivo (ex.: impreciso, processo
-- errado) e a descrição (migration 113). Até aqui ninguém lia esse retorno. Agora uma pessoa com o papel "Revisor de
-- contestações de feedback" (ou o Administrador geral) responde a cada contestação no escopo dela, e o colaborador vê a
-- resposta junto do feedback.
--
-- Uma resposta por avaliação (a linha de `feedback_ratings` que o colaborador gravou): se ele mudar a avaliação depois, a nova
-- linha é uma nova contestação. A resposta registra quem respondeu, a conclusão e o texto — nunca altera o feedback em si
-- (corrigir ou retirar um feedback continua sendo decisão separada).

create table feedback_rating_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  rating_id uuid not null unique references feedback_ratings(id) on delete cascade,
  reviewer_person_id uuid not null references people(id),
  decision text not null check (decision in ('ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED')),
  response text not null check (char_length(response) between 3 and 2000),
  created_at timestamptz not null default now()
);

create index feedback_rating_reviews_organization_created on feedback_rating_reviews (organization_id, created_at desc);
-- Fila de contestações: avaliações "não foi útil" da organização, mais recentes primeiro.
create index if not exists feedback_ratings_down_queue on feedback_ratings (organization_id, created_at desc) where value = 'DOWN';
