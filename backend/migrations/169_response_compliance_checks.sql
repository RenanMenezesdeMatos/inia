-- PEN-017: conferência das respostas da IA contra as regras já cadastradas (assuntos proibidos da Governança e limites de atuação do agente).
-- Nenhum cadastro novo: esta tabela é só o registro de cada conferência. `control` diferencia o que foi conferido antes de chegar à pessoa
-- (PREVENTIVE) do que só pôde ser conferido depois (DETECTIVE: a fala da voz, ou o modo que entrega primeiro). O texto da resposta só fica
-- guardado quando houve violação ou falha da conferência; resposta permitida não guarda conteúdo.

create table response_compliance_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  surface text not null check (surface in ('CHAT', 'VOICE_TOOL', 'VOICE_SPOKEN', 'AGENT_RUN', 'SPECIALIST', 'WORKFLOW_ORCHESTRATOR')),
  control text not null check (control in ('PREVENTIVE', 'DETECTIVE')),
  outcome text not null check (outcome in ('ALLOWED', 'VIOLATION', 'CHECK_FAILED')),
  -- DELIVERED: chegou à pessoa ou ao próximo passo. BLOCKED: foi impedida antes disso. RECORDED: já tinha chegado; ficou só o registro.
  action text not null check (action in ('DELIVERED', 'BLOCKED', 'RECORDED')),
  -- Regras apontadas pela conferência, com o nome e o tipo da época: o cadastro pode mudar depois.
  rules jsonb not null default '[]',
  reason text,
  error_code text,
  flagged_content text,
  -- Referências sem chave estrangeira, como em ai_usage_events e knowledge_version_usages: o registro não prende a limpeza de conversas e execuções.
  conversation_id uuid,
  interaction_id uuid,
  agent_id uuid,
  agent_run_id uuid,
  workflow_enrollment_id uuid,
  prompt_version text not null,
  model text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  check ((outcome = 'ALLOWED') = (flagged_content is null))
);

create index response_compliance_checks_recent_idx on response_compliance_checks (organization_id, created_at desc);
create index response_compliance_checks_flagged_idx on response_compliance_checks (organization_id, created_at desc) where outcome <> 'ALLOWED';
create index response_compliance_checks_interaction_idx on response_compliance_checks (interaction_id) where interaction_id is not null;

insert into data_retention_policies (table_name, note) values
  ('response_compliance_checks', 'Registro das conferências das respostas da IA. Guarda o texto das respostas bloqueadas ou detectadas: prazo = decisão de produto/LGPD.');
