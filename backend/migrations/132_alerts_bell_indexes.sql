-- Sino (auditoria de escalabilidade, 2026-10-13). Todo usuário consulta o sino a cada 60 s.
--
-- 1) Lista do sino: os 20 avisos mais recentes de quem pergunta. O índice antigo `(recipient_id, status, created_at)` ordena
--    por status primeiro, então o banco ordenava TODOS os avisos da pessoa para devolver 20.
-- 2) Badge: não lidas e vivas. O parcial tem exatamente o predicado de `UNREAD_CONDITION` (notifications-repository.ts) e
--    só guarda os avisos que ainda contam.
-- 3) Pendências: revisões VIVAS endereçadas a quem pergunta. O badge de Pendências é calculado no mesmo request do sino;
--    sem este parcial, contar as revisões lia todos os avisos da pessoa. Quase todo mundo tem zero revisões e passa a ler
--    só a raiz do índice.
-- 4) `idx_alerts_open_dedupe (organization_id, dedupe_key) where status in (...)` (001) ficou redundante desde
--    `uq_alerts_dedupe_key (dedupe_key)` (030): o único global já garante a unicidade e é o árbitro de todo
--    `on conflict (dedupe_key)`. Nenhuma escrita usa o parcial como árbitro, e o planejador nunca o escolheu
--    (`pg_stat_user_indexes.idx_scan = 0` no dev, contra 691 mil do único global). Sai para não pesar em cada escrita.

create index idx_alerts_recipient_recent on alerts (recipient_id, created_at desc);
create index idx_alerts_recipient_unread on alerts (recipient_id) where read_at is null and status in ('OPEN', 'SEEN', 'ACKNOWLEDGED');
create index idx_alerts_recipient_live_review on alerts (recipient_id) where alert_type = 'WORKFLOW_HUMAN_REVIEW' and status in ('OPEN', 'SEEN', 'ACKNOWLEDGED');
drop index idx_alerts_open_dedupe;
