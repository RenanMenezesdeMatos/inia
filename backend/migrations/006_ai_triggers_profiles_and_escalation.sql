alter table people
  add column job_title text,
  add column bio text,
  add column strengths jsonb not null default '[]'::jsonb,
  add column development_focus jsonb not null default '[]'::jsonb,
  add column hired_at date;

create type monitoring_trigger_type as enum (
  'DAILY_SAMPLE',
  'RECURRENCE',
  'LOW_URA_SCORE',
  'POSITIVE_URA_SCORE',
  'QUALITY_DEVIATION',
  'CRITICAL_TERM',
  'NEGATIVE_TREND'
);

create table monitoring_triggers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  interaction_id uuid not null references interactions(id) on delete cascade,
  operator_id uuid not null references people(id),
  trigger_type monitoring_trigger_type not null,
  title text not null,
  reason text not null,
  severity text not null check (severity in ('INFO', 'MEDIUM', 'HIGH', 'CRITICAL')),
  metric_code text,
  metric_value numeric,
  threshold_value numeric,
  recurrence_count integer check (recurrence_count is null or recurrence_count > 0),
  source_event_id text,
  detected_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, interaction_id, trigger_type, source_event_id)
);

create table performance_escalations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  operator_id uuid not null references people(id),
  case_id uuid references supervision_cases(id),
  current_level text not null check (current_level in ('OBSERVE', 'ORIENT', 'COACH', 'ACTION_PLAN', 'MANAGER')),
  reason text not null,
  consecutive_cycles integer not null default 1 check (consecutive_cycles > 0),
  previous_actions jsonb not null default '[]'::jsonb,
  ai_recommendation text not null,
  confidence numeric not null check (confidence between 0 and 1),
  status text not null check (status in ('ACTIVE', 'RESOLVED')) default 'ACTIVE',
  generated_at timestamptz not null default now()
);

alter table monitoring_evaluations
  add column trigger_id uuid references monitoring_triggers(id),
  add column ai_summary text,
  add column processed_at timestamptz;

update people set
  job_title='Especialista de Atendimento B2B',
  bio='Atendimento consultivo em retenção, reparo e relacionamento com clientes empresariais.',
  strengths='["Clareza na comunicação", "Domínio de processo", "Acolhimento"]',
  development_focus='["Fechamento consultivo", "Gestão de expectativa"]',
  hired_at='2023-04-10',
  avatar_url='/ANA_LIMA.png'
where id='00000000-0000-4000-8000-000000000030';

insert into monitoring_triggers (id,organization_id,interaction_id,operator_id,trigger_type,title,reason,severity,metric_code,metric_value,threshold_value,recurrence_count,source_event_id,detected_at,metadata) values
 ('00000000-0000-4000-8000-000000000600','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000500','00000000-0000-4000-8000-000000000030','RECURRENCE','Reincidência detectada','Cliente retornou pelo mesmo motivo dentro da janela operacional de 7 dias.','HIGH','RECHAMADA',2,1,2,'CALL-DEMO-001-RECURRENCE',now() - interval '2 days','{"windowDays":7,"previousInteraction":"CALL-DEMO-000"}');

update monitoring_evaluations set
  trigger_id='00000000-0000-4000-8000-000000000600',
  ai_summary='A IA correlacionou a reincidência com a ausência de confirmação do telefone e da disponibilidade no fechamento.',
  processed_at=now()
where id='00000000-0000-4000-8000-000000000502';

insert into performance_escalations (organization_id,operator_id,case_id,current_level,reason,consecutive_cycles,previous_actions,ai_recommendation,confidence) values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000100','COACH','Três indicadores abaixo da meta e reincidência após orientação inicial.',2,'["Feedback de indicador", "Orientação de checklist"]','Realizar coaching com duas chamadas equivalentes e reavaliar os próximos cinco atendimentos.',0.91);

create index idx_monitoring_triggers_operator_date on monitoring_triggers (operator_id, detected_at desc);
create index idx_performance_escalations_active on performance_escalations (organization_id, status, current_level, generated_at desc);
