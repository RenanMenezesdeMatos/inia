update feedbacks set
  strengths='["Acolheu o cliente e confirmou o motivo do contato", "Explicou corretamente o próximo passo"]',
  improvement_points='["Evitar repetir validações já concluídas no encerramento"]',
  best_practices='["Recapitular solução, prazo e canal de acompanhamento em uma única fala"]'
where id='00000000-0000-4000-8000-000000000200';

insert into interactions (id, organization_id, operator_id, reason, started_at, ended_at, external_id) values
 ('00000000-0000-4000-8000-000000000500', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'Reparo', now() - interval '2 days', now() - interval '2 days' + interval '7 minutes', 'CALL-DEMO-001');

insert into transcripts (id, organization_id, interaction_id, content, confidence) values
 ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000500', 'Operador: Entendi que o serviço está instável. Vou validar o sinal e abrir o protocolo. Cliente: Certo. Operador: O protocolo foi aberto e o retorno ocorrerá até amanhã. Posso ajudar em algo mais?', 0.96);

insert into monitoring_evaluations (id, organization_id, interaction_id, operator_id, score, strengths, errors, best_practices, status) values
 ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000500', '00000000-0000-4000-8000-000000000030', 82,
  '["Reconheceu a instabilidade relatada", "Informou protocolo e prazo"]',
  '["Não confirmou o melhor telefone de contato", "Não registrou a disponibilidade do cliente"]',
  '["Aplicar o checklist de reparo antes de encaminhar", "Confirmar entendimento do cliente"]', 'ANALYZED');

insert into feedbacks (id, organization_id, case_id, operator_id, author_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, suggested_approach, strengths, improvement_points, best_practices, context_snapshot) values
 ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000031', 'APPROVED', 'MONITORING',
  'Qualidade da monitoria — 82% para meta de 85%',
  'A transcrição registra protocolo e prazo, mas não contém confirmação do telefone nem da disponibilidade do cliente.',
  'A condução foi segura no encaminhamento, porém o checklist de reparo ficou incompleto.',
  'Procedimento de tratativa de reparo em Fixa — validação de sinal, telefone e disponibilidade.',
  'Manter a clareza no prazo e incluir as duas confirmações ausentes antes do encaminhamento.',
  'Antes de concluir, confirme: “Qual o melhor telefone e em qual período você estará disponível para o contato técnico?”',
  '["Reconheceu o problema", "Comunicou protocolo e prazo com segurança"]',
  '["Confirmar telefone", "Confirmar disponibilidade"]',
  '["Usar o checklist completo", "Validar entendimento antes de encerrar"]',
  '{"interactionId":"00000000-0000-4000-8000-000000000500","transcriptId":"00000000-0000-4000-8000-000000000501"}');
