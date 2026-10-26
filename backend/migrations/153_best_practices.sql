-- BASE DE BOAS PRÁTICAS (2026-10-20) — padrões de conduta OPCIONAL observados com mais frequência nas chamadas dos operadores com
-- melhores resultados de um indicador do que num grupo de referência, no MESMO contexto (motivo/submotivo, Grupo, período).
--
-- Regras que o banco sustenta:
--  - origem explícita: REAL (interações da organização) × SYNTHETIC (corpus fictício separado, `best_practice_synthetic_datasets`);
--    padrão sintético nunca alimenta recomendação de produção (filtro na leitura + coerência origem × dataset aqui);
--  - obrigação do processo nunca vira padrão (a verificação de obrigação descarta OBLIGATION/CONFLICT antes de gravar: só
--    OPTIONAL, DIFFERENTIATED_EXECUTION e UNDETERMINED — este último fica pendente e fora das recomendações);
--  - números são calculados pelo sistema e gravados por versão (uma por análise), com os critérios de força explícitos;
--  - rastreabilidade: cada versão aponta a análise; cada evidência aponta a chamada (trecho mascarado); cada decisão humana fica em
--    `best_practice_pattern_reviews` e em `audit_logs`.
-- Ver docs/dev/memoria/boas-praticas.md.

create table best_practice_synthetic_datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  dataset_key text not null check (dataset_key ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  version integer not null check (version > 0),
  label text not null,
  description text not null,
  -- Operadores, resultados por indicador × competência, chamadas com transcrição e fontes de obrigação FICTÍCIOS. Nunca o gabarito
  -- (que fica só no código de teste): o modelo e a tela leem daqui exatamente o que leriam de dados reais.
  corpus jsonb not null,
  corpus_hash text not null,
  -- GABARITO do dataset (o que cada chamada contém de fato), SEPARADO do corpus: a análise nunca o lê. Só o modo de modelo
  -- SIMULATED_ANSWER_KEY (validação do mecanismo, zero IA, recusado em produção) responde a partir dele.
  answer_key jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dataset_key)
);

create table best_practice_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  data_origin text not null check (data_origin in ('REAL', 'SYNTHETIC')),
  synthetic_dataset_id uuid references best_practice_synthetic_datasets(id) on delete cascade,
  indicator_definition_id uuid not null references indicator_definitions(id) on delete cascade,
  -- População comparável (operação): o Grupo. Sintético = o próprio dataset.
  team_id uuid references teams(id) on delete cascade,
  reference_periods text[] not null check (cardinality(reference_periods) between 1 and 6),
  context_level text not null check (context_level in ('REASON', 'SUB_REASON')),
  channel text,
  comparison text not null check (comparison in ('TOP_QUARTILE_VS_REST', 'TOP_VS_BOTTOM_QUARTILE')),
  -- SIMULATED_ANSWER_KEY = respostas do "modelo" vindas do gabarito do dataset sintético (zero IA, só para validar o mecanismo).
  model_mode text not null check (model_mode in ('REAL', 'SIMULATED_ANSWER_KEY')),
  parameters jsonb not null,
  logic_version text not null,
  status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  outcome text check (outcome in ('PATTERNS_FOUND', 'NO_PATTERN', 'INSUFFICIENT_DATA', 'PARTIAL')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_until timestamptz,
  report jsonb,
  provenance jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  requested_by_person_id uuid references people(id) on delete set null,
  requested_by_account_id uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check ((data_origin = 'SYNTHETIC') = (synthetic_dataset_id is not null)),
  check (data_origin = 'SYNTHETIC' or team_id is not null),
  check (model_mode = 'REAL' or data_origin = 'SYNTHETIC')
);

create index idx_best_practice_analyses_org on best_practice_analyses (organization_id, created_at desc);
create index idx_best_practice_analyses_queue on best_practice_analyses (next_attempt_at) where status in ('QUEUED', 'RUNNING');

create table best_practice_patterns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  data_origin text not null check (data_origin in ('REAL', 'SYNTHETIC')),
  synthetic_dataset_id uuid references best_practice_synthetic_datasets(id) on delete cascade,
  indicator_definition_id uuid not null references indicator_definitions(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  name text not null check (length(btrim(name)) between 3 and 160),
  description text not null,
  observable_definition text not null,
  guidance text not null,
  suggested_phrasing text,
  applies_when text,
  not_applicable_when text,
  review_status text not null check (review_status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'INACTIVE')),
  obligation_status text not null check (obligation_status in ('OPTIONAL', 'DIFFERENTIATED_EXECUTION', 'UNDETERMINED')),
  -- A revisão humana confirmou que não é obrigação (só a partir de UNDETERMINED; registrado em best_practice_pattern_reviews).
  obligation_confirmed_by_review boolean not null default false,
  current_version_id uuid,
  current_strength text not null check (current_strength in ('STRONG', 'MODERATE', 'WEAK', 'INSUFFICIENT')),
  -- Contextos com associação sustentada na versão vigente (denormalizado para o filtro): [{cellKey, reason, subReason, strength}].
  supported_contexts jsonb not null default '[]'::jsonb,
  created_by_analysis_id uuid references best_practice_analyses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((data_origin = 'SYNTHETIC') = (synthetic_dataset_id is not null)),
  check (data_origin = 'SYNTHETIC' or team_id is not null)
);

create index idx_best_practice_patterns_lookup on best_practice_patterns (organization_id, indicator_definition_id, review_status);

create table best_practice_pattern_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  pattern_id uuid not null references best_practice_patterns(id) on delete cascade,
  analysis_id uuid not null references best_practice_analyses(id) on delete cascade,
  version integer not null check (version > 0),
  candidate_key text not null,
  definition_hash text not null,
  -- Como o candidato foi proposto NESTA análise (nome, descrição, definição observável, orientação, sugestão de fala).
  proposed jsonb not null,
  -- Por contexto: números calculados, desfecho, força e cada critério (atendido ou não).
  contexts jsonb not null,
  strength text not null check (strength in ('STRONG', 'MODERATE', 'WEAK', 'INSUFFICIENT')),
  obligation_check jsonb not null,
  limitations text[] not null default '{}',
  period_start date not null,
  period_end date not null,
  reference_periods text[] not null,
  calls_analyzed integer not null,
  operators_analyzed integer not null,
  created_at timestamptz not null default now(),
  unique (pattern_id, version)
);

alter table best_practice_patterns
  add constraint best_practice_patterns_current_version_fk foreign key (current_version_id) references best_practice_pattern_versions(id) on delete set null deferrable initially deferred;

create table best_practice_call_codings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  analysis_id uuid not null references best_practice_analyses(id) on delete cascade,
  candidate_key text not null,
  definition_hash text not null,
  -- Chamada: id da interação (REAL) ou referência do corpus sintético.
  call_ref text not null,
  interaction_id uuid references interactions(id) on delete cascade,
  person_id uuid references people(id) on delete cascade,
  operator_ref text not null,
  group_kind text not null check (group_kind in ('TOP', 'REFERENCE')),
  cell_key text not null,
  status text not null check (status in ('PRESENT', 'ABSENT', 'NOT_APPLICABLE', 'UNCLEAR')),
  turn_ref text,
  quote text,
  quote_verified boolean not null default false,
  unclear_reason text,
  transcript_checksum text,
  reused_from_analysis_id uuid references best_practice_analyses(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (analysis_id, candidate_key, call_ref)
);

create index idx_best_practice_codings_person on best_practice_call_codings (organization_id, person_id, definition_hash) where person_id is not null;
create index idx_best_practice_codings_reuse on best_practice_call_codings (organization_id, call_ref, definition_hash);

create table best_practice_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  pattern_version_id uuid not null references best_practice_pattern_versions(id) on delete cascade,
  call_ref text not null,
  interaction_id uuid references interactions(id) on delete cascade,
  person_id uuid references people(id) on delete cascade,
  -- Rótulo anônimo e estável dentro da versão ("Operador A"): o nome de quem atendeu nunca vai para a base.
  operator_label text not null,
  group_kind text not null check (group_kind in ('TOP', 'REFERENCE')),
  cell_key text not null,
  reason text,
  sub_reason text,
  occurred_at timestamptz,
  turn_ref text not null,
  -- Trecho literal da fala do operador, com CPF/telefone/e-mail/protocolo e nomes de operador mascarados.
  excerpt text not null,
  position integer not null
);

create index idx_best_practice_evidence_version on best_practice_evidence (pattern_version_id, position);

create table best_practice_pattern_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  pattern_id uuid not null references best_practice_patterns(id) on delete cascade,
  action text not null check (action in ('APPROVE', 'REJECT', 'DEACTIVATE', 'REACTIVATE', 'CONFIRM_NOT_OBLIGATION', 'EDIT', 'ANALYSIS_UPDATE')),
  from_status text,
  to_status text,
  reason text,
  changes jsonb,
  actor_person_id uuid references people(id) on delete set null,
  analysis_id uuid references best_practice_analyses(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_best_practice_reviews_pattern on best_practice_pattern_reviews (pattern_id, created_at desc);
