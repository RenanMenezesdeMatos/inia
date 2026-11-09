-- 164 — Ciclo de vida e versões de agentes e orquestradores (decisões de 03/11/2026: PEN-001, PEN-002, PEN-047 em parte,
-- PEN-049, PEN-050 e PEN-065 a PEN-076; docs/especificacao-funcional-ia-vivo/fonte/03-4-rastreabilidade-pendencias.md §4.1).
--
-- Modelo:
-- * As colunas atuais de `agents` (e `agent_knowledge_documents`) continuam sendo a configuração que RODA: passam a espelhar a
--   VERSÃO VIGENTE (`current_version_id`). Tudo o que não fixa versão (chat e voz pela versão vigente do orquestrador, prévia,
--   leitores antigos) continua lendo o mesmo lugar e nunca enxerga um rascunho.
-- * O RASCUNHO fica em `draft_config` (JSON no mesmo formato de `agent_versions.config`), com `draft_revision` para impedir
--   sobrescrita silenciosa entre duas pessoas (PEN-050).
-- * Publicar cria uma linha IMUTÁVEL em `agent_versions` (gatilho abaixo) e copia o rascunho para as colunas vivas.
-- * Orquestrador: cada gravação cria uma versão imutável que fixa a versão do agente orquestrador e de cada especialista
--   (PEN-076); a gravação seguinte só troca essas versões quando alguém escolhe.
--
-- Transição (dados existentes): cada agente e cada orquestrador ganham a versão 1 (origem MIGRATION) com a configuração de hoje;
-- os rascunhos de Workflow passam a referenciar essas versões; versões publicadas de Workflow sem referência explícita usam a
-- versão de origem MIGRATION (a configuração com que rodavam). Nenhum registro é apagado, e nenhum status `active` muda.

-- ── 1. Versões imutáveis do agente ─────────────────────────────────────────────────────────────────────────────────────
create table agent_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  agent_id uuid not null references agents(id) on delete cascade,
  version_number int not null check (version_number > 0),
  config jsonb not null,
  origin text not null check (origin in ('MIGRATION', 'PUBLISH', 'REVERT')),
  reverted_from_version_id uuid references agent_versions(id),
  -- Sem FK para `people`: uma FK com "set null" alteraria a linha, e versão publicada não muda.
  published_by_person_id uuid,
  published_by_name text not null,
  published_at timestamptz not null default now(),
  unique (agent_id, version_number)
);
create index agent_versions_agent_idx on agent_versions(agent_id, version_number desc);

-- Versões publicadas nunca mudam. Só saem junto com o próprio agente (exclusão permitida, sem histórico nem dependências):
-- a cascata da FK chega aqui com profundidade de gatilho ≥ 2; um DELETE direto chega com 1.
create function inia_published_version_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Versão publicada é imutável (%)', tg_table_name using errcode = 'P0001';
  end if;
  if pg_trigger_depth() < 2 then
    raise exception 'Versão publicada só sai junto com o registro dono (%)', tg_table_name using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger agent_versions_immutable before update or delete on agent_versions
  for each row execute function inia_published_version_immutable();

alter table agents
  add column current_version_id uuid references agent_versions(id),
  add column draft_config jsonb,
  add column draft_revision int not null default 0,
  add column draft_updated_at timestamptz,
  add column draft_updated_by_name text;

-- Configuração completa de um agente (o mesmo formato que a aplicação grava em agent_versions.config e em draft_config).
insert into agent_versions (organization_id, agent_id, version_number, config, origin, published_by_name, published_at)
select a.organization_id, a.id, 1,
       jsonb_build_object(
         'name', a.name, 'agentType', a.agent_type, 'objective', a.objective, 'description', a.description,
         'contextPrompt', a.context_prompt, 'scopeType', a.scope_type, 'teamId', a.team_id, 'subteamId', a.subteam_id,
         'specialty', a.specialty, 'specialtyKind', a.specialty_kind, 'domain', a.domain, 'capability', a.capability,
         'consolidatedInput', a.consolidated_input, 'businessDomainId', a.business_domain_id,
         'recommendSupportMaterials', a.recommend_support_materials,
         'investigationCapabilities', to_jsonb(coalesce(a.investigation_capabilities, '{}'::text[])),
         'actionLimitsEnabled', a.action_limits_enabled, 'actionLimits', a.action_limits,
         'knowledgeDocumentIds', coalesce((select jsonb_agg(akd.knowledge_document_id order by akd.knowledge_document_id)
                                             from agent_knowledge_documents akd where akd.agent_id = a.id), '[]'::jsonb)
       ),
       'MIGRATION', 'Migração 164 (configuração em uso antes do versionamento)', a.updated_at
  from agents a;

update agents a set current_version_id = v.id from agent_versions v where v.agent_id = a.id and v.version_number = 1;

alter table agent_history drop constraint agent_history_action_check;
alter table agent_history add constraint agent_history_action_check
  check (action in ('CREATED', 'UPDATED', 'DUPLICATED', 'PUBLISHED', 'REVERTED', 'DRAFT_DISCARDED'));

-- ── 2. Execuções: versão usada e conteúdo testado (PEN-002 item 3, PEN-049) ──────────────────────────────────────────────
alter table agent_runs
  add column agent_version_id uuid references agent_versions(id) on delete cascade,
  add column run_target text check (run_target in ('VERSION', 'DRAFT')),
  add column tested_config jsonb;
-- Execuções anteriores a esta migration ficam sem versão: rodaram com a configuração viva da época, que não foi guardada.

-- ── 3. Conversas: quais agentes atuaram, em qual versão, e chamadas impedidas (PEN-065, PEN-070, PEN-071) ─────────────────
create table assistant_interaction_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  interaction_id uuid not null references assistant_interactions(id) on delete cascade,
  -- Sem cascata: conversa vinculada é histórico de uso e impede a exclusão do agente (PEN-065).
  agent_id uuid not null references agents(id),
  agent_version_id uuid references agent_versions(id),
  orchestrator_id uuid references assistant_orchestrators(id) on delete set null,
  orchestrator_version_id uuid,
  role text not null check (role in ('ORCHESTRATOR_AGENT', 'SPECIALIST')),
  outcome text not null check (outcome in ('EXECUTED', 'BLOCKED_INACTIVE', 'FAILED')),
  created_at timestamptz not null default now(),
  unique (interaction_id, agent_id, role)
);
create index assistant_interaction_agents_agent_idx on assistant_interaction_agents(agent_id);

-- Transição: o que as conversas já registravam — o especialista único (`agent_id`) e cada ferramenta de especialista
-- chamada (`tool_calls[].toolName` = "agent_" + uuid sem hífens). Sem a versão: antes do versionamento ela não existia.
insert into assistant_interaction_agents (organization_id, interaction_id, agent_id, role, outcome, created_at)
select distinct on (i.id, ag.id) i.organization_id, i.id, ag.id, 'SPECIALIST', 'EXECUTED', i.created_at
  from assistant_interactions i
  cross join lateral (
    select i.agent_id id where i.agent_id is not null
    union
    select (substr(tc->>'toolName', 7, 8) || '-' || substr(tc->>'toolName', 15, 4) || '-' || substr(tc->>'toolName', 19, 4) || '-' ||
            substr(tc->>'toolName', 23, 4) || '-' || substr(tc->>'toolName', 27, 12))::uuid
      from jsonb_array_elements(case when jsonb_typeof(i.tool_calls) = 'array' then i.tool_calls else '[]'::jsonb end) tc
     where tc->>'toolName' ~ '^agent_[0-9a-f]{32}$'
  ) ag
  join agents a on a.id = ag.id and a.organization_id = i.organization_id
on conflict do nothing;

-- ── 4. Versões imutáveis do orquestrador (PEN-076) ───────────────────────────────────────────────────────────────────────
create table assistant_orchestrator_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  orchestrator_id uuid not null references assistant_orchestrators(id) on delete cascade,
  version_number int not null check (version_number > 0),
  -- Configuração + `orchestratorAgentVersionId` + `specialists[{agentId, agentVersionId, toolName}]`.
  config jsonb not null,
  origin text not null check (origin in ('MIGRATION', 'PUBLISH')),
  published_by_person_id uuid,
  published_by_name text not null,
  published_at timestamptz not null default now(),
  unique (orchestrator_id, version_number)
);
create index assistant_orchestrator_versions_idx on assistant_orchestrator_versions(orchestrator_id, version_number desc);
create trigger assistant_orchestrator_versions_immutable before update or delete on assistant_orchestrator_versions
  for each row execute function inia_published_version_immutable();

alter table assistant_orchestrators add column current_version_id uuid references assistant_orchestrator_versions(id);

insert into assistant_orchestrator_versions (organization_id, orchestrator_id, version_number, config, origin, published_by_name, published_at)
select o.organization_id, o.id, 1,
       jsonb_build_object(
         'name', o.name, 'scopeType', o.scope_type, 'teamId', o.team_id, 'subteamId', o.subteam_id,
         'invocationMode', o.invocation_mode, 'outputInstructions', o.output_instructions, 'outputSchema', o.output_schema,
         'policyKind', o.policy_kind, 'policyDomains', to_jsonb(o.policy_domains), 'routingPolicy', o.routing_policy,
         'routingDomains', to_jsonb(o.routing_domains), 'structuredOutput', o.structured_output,
         'recommendSupportMaterials', o.recommend_support_materials,
         'domainIds', coalesce((select jsonb_agg(d.business_domain_id order by d.business_domain_id) from assistant_orchestrator_domains d where d.orchestrator_id = o.id), '[]'::jsonb),
         'orchestratorAgentId', o.orchestrator_agent_id,
         'orchestratorAgentVersionId', oa.current_version_id,
         'specialists', coalesce((select jsonb_agg(jsonb_build_object('agentId', s.agent_id, 'agentVersionId', sa.current_version_id, 'toolName', s.tool_name) order by s.agent_id)
                                    from assistant_orchestrator_specialists s join agents sa on sa.id = s.agent_id
                                   where s.orchestrator_id = o.id), '[]'::jsonb)
       ),
       'MIGRATION', 'Migração 164 (configuração em uso antes do versionamento)', o.updated_at
  from assistant_orchestrators o
  join agents oa on oa.id = o.orchestrator_agent_id;

update assistant_orchestrators o set current_version_id = v.id
  from assistant_orchestrator_versions v where v.orchestrator_id = o.id and v.version_number = 1;

-- Versão de cada especialista fixada pela versão vigente do orquestrador (PEN-076): o chat e a voz usam esta, e não a vigente
-- do agente, até o orquestrador ser gravado de novo com outra escolha.
alter table assistant_orchestrator_specialists add column agent_version_id uuid references agent_versions(id);
update assistant_orchestrator_specialists s set agent_version_id = a.current_version_id from agents a where a.id = s.agent_id;
alter table assistant_orchestrators add column orchestrator_agent_version_id uuid references agent_versions(id);
update assistant_orchestrators o set orchestrator_agent_version_id = a.current_version_id from agents a where a.id = o.orchestrator_agent_id;

-- ── 5. Workflows: referência à versão do agente e do orquestrador (PEN-002 item 6, PEN-076) ──────────────────────────────
-- Só o RASCUNHO recebe a referência explícita (o editor passa a mostrá-la). Versões publicadas de Workflow continuam como estão;
-- sem referência, o motor usa a versão de origem MIGRATION — a configuração com que elas rodavam.
update workflows w set draft_graph = jsonb_set(w.draft_graph, '{nodes}', (
  select jsonb_agg(
           case
             when n->>'type' = 'action' and n->'config'->>'actionType' = 'CALL_AGENT' and (n->'config'->>'agentVersionId') is null and a.current_version_id is not null
               then jsonb_set(n, '{config,agentVersionId}', to_jsonb(a.current_version_id::text))
             when n->>'type' = 'orchestrator' and (n->'config'->>'orchestratorVersionId') is null and o.current_version_id is not null
               then jsonb_set(n, '{config,orchestratorVersionId}', to_jsonb(o.current_version_id::text))
             else n
           end order by ord)
    from jsonb_array_elements(w.draft_graph->'nodes') with ordinality e(n, ord)
    left join agents a on a.id::text = n->'config'->>'agentId' and a.organization_id = w.organization_id
    left join assistant_orchestrators o on o.id::text = n->'config'->>'orchestratorId' and o.organization_id = w.organization_id
))
where jsonb_typeof(w.draft_graph->'nodes') = 'array' and jsonb_array_length(w.draft_graph->'nodes') > 0;

-- ── 6. Execuções de Workflow: bloqueio por agente inativo e nova tentativa (PEN-070, PEN-073 a PEN-075) ──────────────────
alter table workflow_enrollments drop constraint workflow_enrollments_status_check;
alter table workflow_enrollments add constraint workflow_enrollments_status_check
  check (status in ('active', 'waiting', 'completed', 'failed', 'dead', 'blocked'));
alter table workflow_enrollments
  add column blocked_at timestamptz,
  add column blocked_node_id text,
  add column blocked_reason text,
  add column blocked_details jsonb,
  add column retry_of_enrollment_id uuid references workflow_enrollments(id),
  add column retry_requested_by_person_id uuid,
  add column retry_requested_by_name text,
  add column retry_requested_at timestamptz,
  add column retry_confirmation jsonb;
create index workflow_enrollments_retry_of_idx on workflow_enrollments(retry_of_enrollment_id) where retry_of_enrollment_id is not null;
