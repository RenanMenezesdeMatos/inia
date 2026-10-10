insert into organizations (id, name, slug) values
  ('00000000-0000-4000-8000-000000000001', 'INIA Demonstração', 'inia-demo');

insert into operations (id, organization_id, name) values
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', 'Atendimento B2B');

insert into teams (id, organization_id, operation_id, name) values
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 'Retenção B2B');

insert into people (id, organization_id, team_id, name, role, avatar_url) values
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', 'Ana Lima', 'OPERATOR', '/ANA_LIMA.png'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', 'Mariana Costa', 'SUPERVISOR', null);

insert into supervision_cases (
  id, organization_id, operator_id, team_id, title, summary, status, priority,
  indicator_code, indicator_value, indicator_target, root_cause, confidence, assignee_id, sla_due_at
) values (
  '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000020',
  'TMA elevado com risco de retrabalho',
  'A INIA correlacionou atendimentos longos com repetição de validações no encerramento e ausência do checklist operacional.',
  'DIAGNOSED', 'P1', 'TMA', '6m21s', '≤ 5m',
  'Repetição de validações e fechamento sem uso consistente do checklist previsto no procedimento.',
  0.91, '00000000-0000-4000-8000-000000000031', now() + interval '8 hours'
);

insert into evidences (organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'INDICATOR', 'TMA acima da meta', 'TMA permaneceu acima de 5 minutos em cinco dos últimos sete dias, atingindo 6m21s no fechamento mais recente.', 'indicator_measurement', 'demo-tma-7d', now() - interval '1 day', encode(digest('demo-tma-7d', 'sha256'), 'hex')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'TRANSCRIPT', 'Validação repetida no encerramento', 'Em três interações, perguntas já confirmadas foram repetidas antes do encerramento, alongando o atendimento sem alterar a solução.', 'transcript_segment', 'demo-transcript-3', now() - interval '2 days', encode(digest('demo-transcript-3', 'sha256'), 'hex')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'PROCEDURE', 'Checklist de encerramento não evidenciado', 'O procedimento PROC-ATD-014 orienta confirmação objetiva dos próximos passos e registro antes do encerramento.', 'knowledge_version', 'PROC-ATD-014-v3', now() - interval '2 days', encode(digest('PROC-ATD-014-v3', 'sha256'), 'hex'));

insert into recommendations (organization_id, case_id, action_type, description, expected_impact, due_at) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'COACHING_1_1', 'Realizar coaching com dois exemplos reais e aplicar o checklist de encerramento nas próximas cinco interações.', 'Reduzir TMA sem comprometer qualidade e diminuir risco de recontato.', now() + interval '3 days');

insert into feedbacks (
  id, organization_id, case_id, operator_id, author_id, status,
  impacted_indicator, evidence_found, observed_behavior, related_procedure,
  recommendation, suggested_approach
) values (
  '00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000030',
  '00000000-0000-4000-8000-000000000031', 'APPROVED',
  'TMA — 6m21s para uma meta de até 5m',
  'Cinco de sete dias acima da meta e repetição de validações em três transcrições.',
  'Perguntas já respondidas voltaram a ser confirmadas no encerramento, sem mudança de solução.',
  'PROC-ATD-014 v3 — checklist de encerramento e registro dos próximos passos.',
  'Aplicar o checklist nas próximas cinco interações e revisar dois atendimentos com a supervisão.',
  'Organize o fechamento em três passos: confirme a solução, explique o próximo passo e registre antes de encerrar.'
);

insert into alerts (organization_id, case_id, recipient_id, title, description, severity, alert_type, status, dedupe_key) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000031', 'TMA acima da meta com causa identificada',
   'Caso priorizado com evidências de repetição de validações e procedimento relacionado.', 'HIGH', 'DEVIATION', 'OPEN', 'case-demo-tma-root-cause');

insert into case_timeline_events (organization_id, case_id, event_type, actor_id, payload) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'CASE_DETECTED', null, '{"source":"rule-engine"}'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'CASE_DIAGNOSED', null, '{"confidence":0.91}'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'FEEDBACK_APPROVED', '00000000-0000-4000-8000-000000000031', '{"feedbackId":"00000000-0000-4000-8000-000000000200"}');
