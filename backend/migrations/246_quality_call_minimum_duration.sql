-- Regra geral da organização: duração mínima de uma chamada para a análise de QUALIDADE (QUALITY_CALL_MIN_DURATION_V1).
--
-- Chamada mais curta que o mínimo (ou sem a duração conhecida) não é sorteada na monitoria aleatória do Workflow e não entra no
-- levantamento de boas práticas: quase sempre é engano, queda ou transferência imediata, e não mostra um atendimento para
-- avaliar. Não vale para o gatilho por Flag (o sinal da chamada é diagnóstico: uma desconexão curta é justamente o que importa)
-- nem para a investigação de indicador. 0 = regra desligada (toda chamada entra, mesmo sem duração conhecida).
-- Muda só pela Governança (configuração da organização inteira), com auditoria em audit_logs.

alter table organizations
  add column minimum_quality_call_seconds integer not null default 60
    constraint organizations_minimum_quality_call_seconds_check check (minimum_quality_call_seconds between 0 and 600);
