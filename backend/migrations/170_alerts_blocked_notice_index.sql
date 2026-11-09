-- Sino: a permissão atual decide quais avisos de execução bloqueada a pessoa vê e quantos contam nos não lidos (docs/qa/workflows).
-- Todo usuário consulta o sino a cada 60 s, e esta consulta roda para todos: o índice só guarda este tipo de aviso, então quem não
-- tem nenhum não percorre o próprio histórico de avisos.
create index if not exists idx_alerts_recipient_blocked_notice on alerts (recipient_id) where alert_type = 'WORKFLOW_EXECUTION_BLOCKED';
