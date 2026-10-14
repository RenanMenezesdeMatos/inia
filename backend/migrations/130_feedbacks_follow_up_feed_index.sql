-- Acompanhamento paginado por keyset (auditoria de escalabilidade, 2026-10-13).
--
-- O feed do colaborador (`/operator/overview` e `/operator/feedbacks`) e o feed da estrutura (`/analytics/follow-ups`) leem só
-- feedback PUBLICADO, na ordem canônica do Acompanhamento: `coalesce(published_at, created_at)` mais recente primeiro, desempate
-- por id. Sem este índice, cada página ordenava o histórico inteiro da pessoa (ou de todos os liderados) antes do LIMIT.
-- Parcial: rascunho/em revisão não entra no feed e não ocupa o índice.

create index idx_feedbacks_operator_feed on feedbacks (operator_id, (coalesce(published_at, created_at)) desc, id desc)
  where status = 'PUBLISHED';
