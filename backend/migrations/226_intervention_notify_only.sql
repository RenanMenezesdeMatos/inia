-- Políticas de acompanhamento — "só avisar" (18/11/2026).
-- Uma regra pode AVISAR quem lidera (resumo da INIA no Acompanhamento) sem criar a ação: a decisão fica NOTIFIED e nenhuma
-- intervenção é aberta. O resultado agregado da avaliação ganha o valor NOTIFIED; nada do que já foi gravado muda.
alter table intervention_policy_evaluations drop constraint if exists intervention_policy_evaluations_outcome_check;
alter table intervention_policy_evaluations add constraint intervention_policy_evaluations_outcome_check
  check (outcome in ('RECOMMENDED', 'EXISTING', 'CREATED', 'PENDING_APPROVAL', 'NOTIFIED', 'NO_MATCH', 'INCONCLUSIVE', 'CONFLICT', 'SUPPRESSED', 'NOT_APPLICABLE'));
