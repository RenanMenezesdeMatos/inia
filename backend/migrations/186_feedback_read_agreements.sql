-- Ciência com concordância (2026-11-10): a avaliação do feedback passa a ser feita NA confirmação de ciência.
-- Desenho: docs/designs/ciencia-com-concordancia/design_draft.md (v2, revisão Goldfish).
--
-- Ao confirmar a ciência (login e senha da própria conta, migration 114), o colaborador escolhe explicitamente
-- "Concordo com o feedback" ou "Não concordo com o feedback". Discordar exige o motivo (os mesmos códigos da avaliação de
-- 113) e a justificativa. Ciência continua sendo "li": concordando ou discordando, ela é registrada.
--
-- Regras:
--   * UMA escolha por fonte, gravada na MESMA transação da ciência (`created_at` = instante da ciência) e nunca alterada.
--     Ciência anterior a esta tabela fica sem escolha (nada é presumido nem convertido das avaliações antigas); o próprio
--     colaborador pode registrar a escolha uma vez, com login e senha (canal de contestação, LGPD art. 20).
--   * Tabela PRÓPRIA, nunca `feedback_ratings`: lá é "este conteúdo foi útil?" (histórico mutável, lido pela Monitoria de
--     usabilidade), que a partir daqui é só leitura.
--   * A discordância é uma CONTESTAÇÃO: entra na mesma fila e na mesma revisão humana de 150 (`feedback_rating_reviews` ganha
--     `agreement_id`; cada resposta aponta para a avaliação antiga OU para a discordância). "O que é contestação" mora na visão
--     `feedback_contestations`.
--   * Pessoa e conta são as da sessão autenticada que confirmou.
create table if not exists feedback_read_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  account_id uuid not null references user_accounts(id),
  source_kind text not null check (source_kind in ('PUBLISHED_FEEDBACK', 'INTERACTION_FEEDBACK_DELIVERY')),
  feedback_id uuid references feedbacks(id) on delete cascade,
  interaction_delivery_id uuid references interaction_feedback_deliveries(id) on delete cascade,
  agreement text not null check (agreement in ('AGREE', 'DISAGREE')),
  reason text check (reason in ('POOR_WRITING', 'WRONG_PROCESS', 'UNCLEAR', 'INIA_COULD_NOT_ANSWER', 'INACCURATE', 'NOT_HELPFUL', 'OTHER')),
  -- O zod da API exige 3–1000 unidades de texto; aqui, ao menos 1 caractere visível (emoji conta 2 no zod e 1 no banco).
  justification text check (justification is null or char_length(btrim(justification)) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint feedback_read_agreements_one_source check (
    (source_kind = 'PUBLISHED_FEEDBACK' and feedback_id is not null and interaction_delivery_id is null)
    or (source_kind = 'INTERACTION_FEEDBACK_DELIVERY' and interaction_delivery_id is not null and feedback_id is null)
  ),
  -- Motivo e justificativa existem exatamente quando o colaborador não concorda.
  constraint feedback_read_agreements_disagree_detail check ((agreement = 'DISAGREE') = (reason is not null and justification is not null))
);

-- Uma escolha por fonte: a garantia final contra duplicata (cliques repetidos, outra aba, reenvio).
create unique index if not exists feedback_read_agreements_feedback on feedback_read_agreements (feedback_id) where feedback_id is not null;
create unique index if not exists feedback_read_agreements_delivery on feedback_read_agreements (interaction_delivery_id) where interaction_delivery_id is not null;
-- Fila de contestações: discordâncias da organização, mais recentes primeiro.
create index if not exists feedback_read_agreements_disagree_queue on feedback_read_agreements (organization_id, created_at desc) where agreement = 'DISAGREE';

-- A escolha registrada nunca muda (só sai junto com a fonte, pela cascata de uma exclusão física).
create or replace function inia_feedback_read_agreement_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'A concordância registrada na ciência é imutável (%)', tg_table_name using errcode = 'P0001';
end $$;
drop trigger if exists feedback_read_agreements_immutable on feedback_read_agreements;
create trigger feedback_read_agreements_immutable before update on feedback_read_agreements
  for each row execute function inia_feedback_read_agreement_immutable();

-- A revisão humana responde a uma avaliação antiga "não foi útil" OU a uma discordância (nunca às duas).
alter table feedback_rating_reviews add column if not exists agreement_id uuid unique references feedback_read_agreements(id) on delete cascade;
alter table feedback_rating_reviews alter column rating_id drop not null;
alter table feedback_rating_reviews drop constraint if exists feedback_rating_reviews_one_target;
alter table feedback_rating_reviews add constraint feedback_rating_reviews_one_target check ((rating_id is null) <> (agreement_id is null));

-- CONTESTAÇÕES — o que a revisão humana responde, num lugar só: a avaliação "não foi útil" (legado, com `superseded_at` quando
-- o colaborador a trocou ou retirou) e a discordância registrada na ciência (nunca encerrada). Com a resposta, se houver.
-- Leitores: a fila e o detalhe da Administração e o item do Acompanhamento do próprio colaborador.
create or replace view feedback_contestations as
  select r.id, 'USEFULNESS_RATING'::text origin, r.organization_id, r.person_id, r.source_kind, r.feedback_id, r.interaction_delivery_id,
         r.reason, r.comment, r.created_at, r.superseded_at,
         rv.id review_id, rv.reviewer_person_id, rv.decision review_decision, rv.response review_response, rv.created_at review_created_at
    from feedback_ratings r
    left join feedback_rating_reviews rv on rv.rating_id = r.id
   where r.value = 'DOWN'
  union all
  select a.id, 'READ_AGREEMENT'::text, a.organization_id, a.person_id, a.source_kind, a.feedback_id, a.interaction_delivery_id,
         a.reason, a.justification, a.created_at, null::timestamptz,
         rv.id, rv.reviewer_person_id, rv.decision, rv.response, rv.created_at
    from feedback_read_agreements a
    left join feedback_rating_reviews rv on rv.agreement_id = a.id
   where a.agreement = 'DISAGREE';
