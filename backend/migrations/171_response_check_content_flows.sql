-- PEN-018: a conferência das respostas passa a cobrir conteúdos entregues sem conversa (feedback, report, intervenção, boa prática).
-- O acesso a eles é mais restrito que o deste registro, então aqui fica só a referência: regra, resultado e onde está o conteúdo.
alter table response_compliance_checks drop constraint response_compliance_checks_surface_check;
alter table response_compliance_checks add constraint response_compliance_checks_surface_check
  check (surface in ('CHAT', 'VOICE_TOOL', 'VOICE_SPOKEN', 'AGENT_RUN', 'SPECIALIST', 'WORKFLOW_ORCHESTRATOR', 'FEEDBACK_MESSAGE', 'REPORT_ANALYSIS', 'INTERVENTION_NARRATIVE', 'INTERVENTION_DRAFT', 'BEST_PRACTICE', 'INTERACTION_FEEDBACK'));

-- Antes o texto era obrigatório em toda violação ou falha. Continua proibido guardar texto do que foi permitido.
alter table response_compliance_checks drop constraint response_compliance_checks_check;
alter table response_compliance_checks add constraint response_compliance_checks_allowed_without_text_check
  check (outcome <> 'ALLOWED' or flagged_content is null);

alter table response_compliance_checks add column source_ref text;
