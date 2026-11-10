-- Resolutividade do chat (Apoio com Anjo, Parte A — docs/designs/apoio-com-anjo/design_draft.md).
--
-- 1. MOTIVO DA DESCURTIDA: o formulário da descurtida no chat livre grava, junto da versão DOWN da avaliação (migration 158), o
--    motivo de lista fechada, o comentário e a resposta a "Você ainda precisa de ajuda com isso?". Uma linha por versão da
--    avaliação; sai junto com ela (cascade). `person_id` = dona da avaliação, para a exportação do titular, que segue chaves
--    estrangeiras simples para `people`.
-- 2. SINAIS DA RESPOSTA: o que aconteceu na consulta da INIA, calculado por código no momento da gravação (nunca lendo o texto da
--    resposta): consulta às bases sem trecho, esclarecimento que concluiu que as bases não sustentam, consulta que falhou,
--    especialista bloqueado e — na mensagem do operador — turno que terminou sem resposta. Toda mensagem da INIA do chat livre
--    ganha a linha, com lista vazia quando nada aconteceu: "sem linha" = anterior a esta migration. Sai junto com a mensagem
--    (filho de `assistant_interactions` no catálogo de retenção).
--
-- Só cria tabelas: nenhuma coluna nova em assistant_interactions (o chat não trava durante a migration).

create table if not exists assistant_interaction_rating_details (
  rating_id uuid primary key references assistant_interaction_ratings(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  reason text not null check (reason in ('WRONG_INFORMATION', 'DID_NOT_ANSWER', 'NOT_FOUND', 'INCOMPLETE', 'HARD_TO_UNDERSTAND', 'OTHER')),
  comment text check (comment is null or char_length(comment) between 3 and 1000),
  still_needs_help boolean not null,
  catalog_version text not null,
  check (reason <> 'OTHER' or comment is not null)
);

create table if not exists assistant_reply_signals (
  interaction_id uuid primary key references assistant_interactions(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  signals text[] not null default '{}'
    check (signals <@ array['KNOWLEDGE_NOT_FOUND', 'KNOWLEDGE_INSUFFICIENT', 'CONSULTATION_FAILED', 'SPECIALIST_BLOCKED', 'NO_REPLY']::text[]),
  signal_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_reply_signals_org_created on assistant_reply_signals (organization_id, created_at);
