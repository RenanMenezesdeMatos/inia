create table prohibited_topics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  required_behavior text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table glossary_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  term text not null,
  definition text not null,
  feedback_application text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, term)
);

create table interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operator_id uuid not null references people(id),
  reason text not null,
  channel text not null default 'VOICE',
  started_at timestamptz not null,
  ended_at timestamptz not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, external_id),
  check (ended_at > started_at)
);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  interaction_id uuid not null references interactions(id) on delete cascade,
  version integer not null default 1,
  content text not null,
  language text not null default 'pt-BR',
  confidence numeric check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (interaction_id, version)
);

create table diagnostic_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  reason text not null,
  indicator_code text not null,
  sample_size integer not null check (sample_size > 0),
  reference_group text not null,
  measured_difference text not null,
  finding text not null,
  phrase_example text not null,
  rhythm_finding text not null,
  confidence numeric not null check (confidence between 0 and 1),
  generated_at timestamptz not null default now(),
  unique (organization_id, reason, indicator_code)
);

insert into prohibited_topics (organization_id, name, required_behavior) values
 ('00000000-0000-4000-8000-000000000001', 'Diagnóstico médico', 'Não orientar; encaminhar ao canal responsável'),
 ('00000000-0000-4000-8000-000000000001', 'Promessa financeira não autorizada', 'Não criar valores, descontos ou prazos');

insert into glossary_terms (organization_id, term, definition, feedback_application) values
 ('00000000-0000-4000-8000-000000000001', 'TMA', 'Tempo Médio de Atendimento', 'Indicador de eficiência; avaliar junto da qualidade.'),
 ('00000000-0000-4000-8000-000000000001', 'Rechamada', 'Novo contato sobre o mesmo motivo', 'Sinaliza possível falha de resolução ou expectativa.'),
 ('00000000-0000-4000-8000-000000000001', 'CPE', 'Equipamento instalado no cliente', 'Usar a terminologia expandida no feedback ao operador.');

insert into diagnostic_insights (organization_id, reason, indicator_code, sample_size, reference_group, measured_difference, finding, phrase_example, rhythm_finding, confidence) values
 ('00000000-0000-4000-8000-000000000001', 'Reparo', 'TMA', 184, '25% melhores', '-1m42s', 'Encerram a chamada com uma recapitulação curta e não repetem validações já confirmadas.', 'Recapitulando: hoje validamos o sinal, o protocolo está aberto e o próximo retorno ocorre até amanhã.', 'Silêncios 31% menores', 0.92),
 ('00000000-0000-4000-8000-000000000001', 'Contestação de cobrança', 'NPS', 96, '20% melhores', '+18 pts', 'Explicam primeiro o que será analisado, informam prazo e demonstram responsabilidade pelo acompanhamento.', 'Eu entendi o impacto. Vou deixar registrado o que será analisado e explicar quando você terá o retorno.', 'Resposta inicial 22% mais rápida', 0.89),
 ('00000000-0000-4000-8000-000000000001', 'Troca de CPE', 'Qualidade', 73, '30% melhores', '+14 p.p.', 'Confirmam ambiente, serial, evidência da falha e janela antes de transferir para a etapa técnica.', 'Antes de encaminhar, vou confirmar quatro informações para evitar que sua solicitação retorne.', 'Checklist completo em 94%', 0.95);

create index idx_prohibited_topics_active on prohibited_topics (organization_id, active);
create index idx_glossary_terms_active on glossary_terms (organization_id, active);
create index idx_interactions_reason_started on interactions (organization_id, reason, started_at desc);
create index idx_diagnostic_insights_filter on diagnostic_insights (organization_id, reason, indicator_code);
