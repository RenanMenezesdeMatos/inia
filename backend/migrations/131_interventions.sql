-- Políticas de acompanhamento e intervenções (2026-10-13). Aditiva: só tabelas NOVAS; nada existente muda.
--
-- Separa cinco conceitos que antes viviam misturados num "nível de escalonamento" fixo (performance_escalations, migration
-- 006, que continua como legado somente leitura):
--   competencies                         → competências administráveis, com vínculos EXPLÍCITOS a documentos publicados da
--                                          base, práticas/critérios do diagnóstico, indicadores e atividades.
--   intervention_types (+ _versions)     → TIPO de intervenção: dado administrável (chave estável) que usa capacidades técnicas
--                                          implementadas em código. Versão publicada é imutável.
--   intervention_policies (+ _versions)  → POLÍTICA: condições para recomendar ou abrir intervenções. Rascunho → publicada
--                                          (imutável) com vigência (`effective_from`). Inativar nunca apaga versões.
--   intervention_policy_evaluations      → cada avaliação: versão da política, fatos (snapshot), condições, decisões e
--                                          justificativa. Só inserção; reavaliação é outra linha ligada à original.
--   intervention_reports (+ _narratives) → RELATÓRIO DE INTELIGÊNCIA de uma avaliação que fundamentou ações: parte estruturada
--                                          determinística (fatos, critérios, ações) imutável + tentativas da narrativa da IA
--                                          (só inserção; falha registrada; nova tentativa nunca reabre intervenções).
--   interventions (+ _items, _events)    → a ocorrência concreta, sempre ligada a um SupervisionCase. Histórico só inserção.
--
-- Nenhum tipo de negócio (observar, orientar, treinar, plano de ação, revisão pela liderança) nasce aqui: exemplos só pelo
-- seed de demonstração (backend/seeds/demo). Configuração é jsonb validado pela aplicação (contratos versionados), nunca script.

create table competencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  key text not null check (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  knowledge_document_ids uuid[] not null default '{}',
  practice_keys text[] not null default '{}',
  criterion_keys text[] not null default '{}',
  indicator_codes text[] not null default '{}',
  activities jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table intervention_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  key text not null check (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  active boolean not null default true,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table intervention_type_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  type_id uuid not null references intervention_types(id),
  version integer not null check (version >= 1),
  status text not null check (status in ('DRAFT', 'PUBLISHED')),
  definition jsonb not null,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by uuid references user_accounts(id) on delete set null,
  published_at timestamptz,
  unique (type_id, version),
  check ((status = 'DRAFT') = (published_at is null))
);
create unique index intervention_type_one_draft on intervention_type_versions (type_id) where status = 'DRAFT';

create table intervention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  key text not null check (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  scope_type text not null check (scope_type in ('ORGANIZATION', 'GROUP', 'SUBGROUP')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  active boolean not null default true,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key),
  check (
    (scope_type = 'ORGANIZATION' and team_id is null and subteam_id is null)
    or (scope_type = 'GROUP' and team_id is not null and subteam_id is null)
    or (scope_type = 'SUBGROUP' and team_id is not null and subteam_id is not null)
  )
);

-- Vigência: a versão em vigor num instante T é a PUBLICADA de maior `effective_from` <= T. `effective_from` nunca é anterior
-- à publicação (a aplicação garante), então o que estava em vigor num instante passado nunca muda.
create table intervention_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  policy_id uuid not null references intervention_policies(id),
  version integer not null check (version >= 1),
  status text not null check (status in ('DRAFT', 'PUBLISHED')),
  definition jsonb not null,
  effective_from timestamptz,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by uuid references user_accounts(id) on delete set null,
  published_at timestamptz,
  unique (policy_id, version),
  check ((status = 'DRAFT') = (published_at is null)),
  check ((status = 'DRAFT') = (effective_from is null))
);
create unique index intervention_policy_one_draft on intervention_policy_versions (policy_id) where status = 'DRAFT';
create index intervention_policy_versions_in_force on intervention_policy_versions (policy_id, effective_from desc) where status = 'PUBLISHED';

-- Versão publicada (de tipo ou de política) é imutável e nunca apagada; só rascunho muda ou é descartado. A única exceção é a
-- PURGA explícita de dados de teste/demonstração (limpeza das provas de banco e reset da massa demo), que precisa ligar
-- `set local inia.history_purge = 'on'` na própria transação — nenhuma rota da aplicação faz isso.
create function intervention_config_version_guard() returns trigger language plpgsql as $$
begin
  if current_setting('inia.history_purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'versão publicada não pode ser apagada (%)', tg_table_name;
    end if;
    return old;
  end if;
  if old.status <> 'DRAFT' and to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    raise exception 'versão publicada é imutável (%)', tg_table_name;
  end if;
  return new;
end;
$$;
create trigger intervention_type_version_guard before update or delete on intervention_type_versions
  for each row execute function intervention_config_version_guard();
create trigger intervention_policy_version_guard before update or delete on intervention_policy_versions
  for each row execute function intervention_config_version_guard();

create table intervention_policy_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  policy_id uuid not null references intervention_policies(id),
  policy_version_id uuid references intervention_policy_versions(id),
  person_id uuid not null references people(id),
  origin text not null check (origin in ('WORKFLOW', 'MANUAL', 'REEVALUATION')),
  workflow_id uuid,
  workflow_version_id uuid,
  enrollment_id uuid,
  node_id text,
  requested_by uuid references people(id),
  as_of timestamptz not null,
  evaluated_at timestamptz not null default now(),
  outcome text not null check (outcome in ('RECOMMENDED', 'EXISTING', 'CREATED', 'PENDING_APPROVAL', 'NO_MATCH', 'INCONCLUSIVE', 'CONFLICT', 'SUPPRESSED', 'NOT_APPLICABLE')),
  evaluator_version text not null,
  facts jsonb not null,
  rules jsonb not null,
  decisions jsonb not null,
  justification text not null,
  supersedes_evaluation_id uuid references intervention_policy_evaluations(id),
  reevaluation_reason text,
  idempotency_key text not null,
  unique (organization_id, idempotency_key),
  check ((origin = 'REEVALUATION') = (supersedes_evaluation_id is not null))
);
create index intervention_policy_evaluations_person on intervention_policy_evaluations (organization_id, person_id, evaluated_at desc);
create index intervention_policy_evaluations_policy on intervention_policy_evaluations (organization_id, policy_id, evaluated_at desc);

-- Um relatório por avaliação que fundamentou alguma ação; várias intervenções da mesma avaliação compartilham o mesmo.
create table intervention_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  evaluation_id uuid not null unique references intervention_policy_evaluations(id),
  case_id uuid not null references supervision_cases(id),
  person_id uuid not null references people(id),
  contract_version text not null,
  structured jsonb not null,
  created_at timestamptz not null default now()
);
create index intervention_reports_case on intervention_reports (case_id, created_at desc);
create index intervention_reports_person on intervention_reports (organization_id, person_id, created_at desc);

-- Narrativa redigida pela IA a partir da parte estruturada: cada tentativa é uma linha (pronta ou falha). A vigente é a última
-- pronta; a parte estruturada nunca depende dela.
create table intervention_report_narratives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  report_id uuid not null references intervention_reports(id),
  attempt integer not null check (attempt >= 1),
  status text not null check (status in ('READY', 'FAILED')),
  narrative jsonb,
  error text,
  requested_by uuid references people(id),
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (report_id, attempt),
  check ((status = 'READY') = (narrative is not null))
);

create table interventions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  case_id uuid not null references supervision_cases(id),
  type_id uuid not null references intervention_types(id),
  type_version_id uuid not null references intervention_type_versions(id),
  type_key text not null,
  -- Identidade de deduplicação: (pessoa, tipo, assunto). Assunto = "INDICATOR:<código>" ou "POLICY:<chave>" ou "GENERAL".
  subject_key text not null check (char_length(subject_key) between 1 and 120),
  indicator_code text,
  policy_id uuid references intervention_policies(id),
  policy_version_id uuid references intervention_policy_versions(id),
  -- Adiáveis até o commit: a avaliação e o relatório são só inserção e já nascem com as decisões finais (inclusive a de uma
  -- corrida perdida para outra avaliação), então a intervenção é gravada antes deles na MESMA transação.
  evaluation_id uuid references intervention_policy_evaluations(id) deferrable initially deferred,
  report_id uuid references intervention_reports(id) deferrable initially deferred,
  rule_key text,
  origin text not null check (origin in ('MANUAL', 'WORKFLOW')),
  workflow_id uuid,
  workflow_version_id uuid,
  enrollment_id uuid,
  node_id text,
  opened_by uuid references people(id),
  -- Quem aceitou a proposta (separação de funções: não aprova nem decide a própria proposta).
  accepted_by uuid references people(id),
  responsible_id uuid not null references people(id),
  approver_id uuid references people(id),
  -- Para quem a aprovação/decisão foi endereçada (Pendências). A permissão é conferida de novo na hora de decidir.
  approval_recipient_ids uuid[] not null default '{}',
  status text not null check (status in ('PROPOSED', 'AWAITING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  sensitive boolean not null default false,
  reason text not null check (char_length(btrim(reason)) >= 1),
  initial_situation jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  form_values jsonb not null default '{}'::jsonb,
  ai_draft jsonb,
  outcome jsonb,
  due_at date not null,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  signal_count integer not null default 1 check (signal_count >= 1),
  last_signal_at timestamptz not null default now(),
  revision integer not null default 0,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check ((origin = 'WORKFLOW') = (enrollment_id is not null)),
  check ((status = 'COMPLETED') = (completed_at is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null))
);
-- No máximo UMA intervenção ATIVA por identidade — a proteção contra duas execuções concorrentes (ou duas políticas que se
-- sobrepõem) abrirem a mesma intervenção duas vezes vale no banco, não só na aplicação.
create unique index interventions_one_active_per_identity on interventions (organization_id, person_id, type_id, subject_key)
  where status in ('PROPOSED', 'AWAITING_APPROVAL', 'IN_PROGRESS');
create index interventions_responsible on interventions (organization_id, responsible_id, status);
create index interventions_approver on interventions (organization_id, approver_id, status) where approver_id is not null;
create index interventions_person on interventions (organization_id, person_id, created_at desc);
create index interventions_case on interventions (case_id);

create table intervention_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  intervention_id uuid not null references interventions(id),
  kind text not null check (kind in ('TASK', 'CHECKPOINT', 'ACTIVITY')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  owner_id uuid references people(id),
  due_at date,
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'SKIPPED')),
  result jsonb,
  completed_at timestamptz,
  completed_by uuid references people(id),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'PENDING') = (completed_at is null))
);
create index intervention_items_intervention on intervention_items (intervention_id, position);

create table intervention_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  intervention_id uuid not null references interventions(id),
  event_type text not null check (event_type ~ '^[A-Z][A-Z_]{2,59}$'),
  actor_kind text not null check (actor_kind in ('HUMAN', 'SYSTEM', 'WORKFLOW')),
  actor_id uuid references people(id),
  from_status text,
  to_status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((actor_kind = 'HUMAN') = (actor_id is not null))
);
create index intervention_events_intervention on intervention_events (intervention_id, created_at);

-- Histórico (avaliações e eventos) só recebe inserção: nunca muda nem é apagado (mesma exceção de purga explícita acima).
create function intervention_append_only_guard() returns trigger language plpgsql as $$
begin
  if current_setting('inia.history_purge', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'registro histórico não pode ser alterado nem apagado (%)', tg_table_name;
end;
$$;
create trigger intervention_policy_evaluations_append_only before update or delete on intervention_policy_evaluations
  for each row execute function intervention_append_only_guard();
create trigger intervention_events_append_only before update or delete on intervention_events
  for each row execute function intervention_append_only_guard();
create trigger intervention_reports_append_only before update or delete on intervention_reports
  for each row execute function intervention_append_only_guard();
create trigger intervention_report_narratives_append_only before update or delete on intervention_report_narratives
  for each row execute function intervention_append_only_guard();
