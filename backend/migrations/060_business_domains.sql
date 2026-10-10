-- Domínios de negócio como CATÁLOGO ADMINISTRÁVEL (2026-09-16) — migration ADITIVA.
--
-- Antes, os domínios de processo eram um enum de código (FATURAMENTO/RETENCAO/SUPORTE/CADASTRO)
-- repetido em check constraints (053/057), no backend (agent-specialty.ts, orchestrator-policy.ts)
-- e no frontend (orchestrator-policy.ts). Um domínio novo exigia migration + enum + deploy.
-- Agora domínio é DADO: `business_domains` é a fonte de verdade, o Agent DOMAIN aponta por FK
-- (`agents.business_domain_id`) e o Orquestrador DOMAINS tem 1..N domínios numa relação
-- (`assistant_orchestrator_domains`). A aplicação conhece só os TIPOS (DOMAIN/CROSS_CUTTING/
-- PERFORMANCE/SYNTHESIS, DOMAINS/OPEN) — nunca os códigos concretos.
--
-- Compatibilidade (ADD → BACKFILL → DUAL READ → DUAL WRITE → MIGRAR CONSUMIDORES → DEPRECAR):
-- - NADA é removido: `agents.specialty`, `agents.domain`, `assistant_orchestrators.policy_kind/
--   policy_domains/routing_domains` continuam existindo e sendo escritos (dual-write com o CÓDIGO
--   do domínio) enquanto o runtime lê primeiro a FK/relação e cai para o código legado
--   (dual-read — business-domains/domain/business-domain.ts + agent-specialty.ts + orchestrator-policy.ts).
-- - As check constraints que listavam os quatro códigos são RELAXADAS para o formato de código
--   (`^[A-Z][A-Z0-9_]{1,39}$`, o mesmo do catálogo de indicadores) — sem isso, um domínio novo
--   (ex.: LOGISTICA) não poderia ser dual-escrito nas colunas legadas.
-- - Backfill DETERMINÍSTICO e idempotente: os quatro códigos já reconhecidos pela arquitetura
--   viram registros do catálogo em cada organização; agentes DOMAIN recebem a FK pelo código;
--   orquestradores recebem a relação a partir de `routing_domains` (ou `policy_domains` no legado
--   ainda sem `routing_policy`). Nada é inferido de nomes de Grupos, Agents ou bases.
-- - Um Orquestrador DOMAINS continua obrigado a ter ≥ 1 código em `routing_domains` (057); a
--   relação nova é validada por código no backend (assistant-router.ts), nunca só pela constraint.

create table if not exists business_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create index if not exists idx_business_domains_org_active on business_domains(organization_id, active);

-- Backfill dos quatro domínios já reconhecidos pela arquitetura anterior (códigos reais das
-- colunas legadas), em toda organização existente. Idempotente pelo unique (organization_id, code).
insert into business_domains (organization_id, code, name, description)
select o.id, d.code, d.name, d.description
  from organizations o
 cross join (values
   ('FATURAMENTO', 'Faturamento', 'Processos de fatura, cobrança de valores contestados, segunda via e negociação de débito.'),
   ('RETENCAO', 'Retenção e Cancelamento', 'Processos de retenção, cancelamento e ofertas de permanência.'),
   ('SUPORTE', 'Suporte Técnico', 'Processos de diagnóstico e resolução de problemas técnicos do serviço.'),
   ('CADASTRO', 'Cadastro e Titularidade', 'Processos de cadastro, alteração cadastral e troca de titularidade.')
 ) as d(code, name, description)
on conflict (organization_id, code) do nothing;

-- Agent DOMAIN → domínio de negócio por FK. A coluna legada `domain` (código) continua.
alter table agents
  add column if not exists business_domain_id uuid references business_domains(id);

create index if not exists idx_agents_business_domain on agents(business_domain_id);

-- Relaxa as listas fixas de código (053/057) para o FORMATO de código: o catálogo é a autoridade.
alter table agents drop constraint if exists agents_domain_check;
alter table agents
  add constraint agents_domain_check check (domain is null or domain ~ '^[A-Z][A-Z0-9_]{1,39}$');

alter table agents drop constraint if exists agents_specialty_check;
alter table agents
  add constraint agents_specialty_check check (specialty is null or specialty ~ '^[A-Z][A-Z0-9_]{1,39}$');

update agents a
   set business_domain_id = bd.id,
       updated_at = now()
  from business_domains bd
 where bd.organization_id = a.organization_id
   and bd.code = a.domain
   and a.business_domain_id is null
   and a.domain is not null;

-- Orquestrador DOMAINS → N domínios de negócio por relação. `routing_domains`/`policy_domains`
-- (códigos) continuam como espelho legado (dual-write).
create table if not exists assistant_orchestrator_domains (
  orchestrator_id uuid not null references assistant_orchestrators(id) on delete cascade,
  business_domain_id uuid not null references business_domains(id),
  created_at timestamptz not null default now(),
  primary key (orchestrator_id, business_domain_id)
);

create index if not exists idx_assistant_orchestrator_domains_domain on assistant_orchestrator_domains(business_domain_id);

insert into assistant_orchestrator_domains (orchestrator_id, business_domain_id)
select o.id, bd.id
  from assistant_orchestrators o
 cross join lateral unnest(
   case when o.routing_policy = 'DOMAINS' then o.routing_domains
        when o.routing_policy is null and o.policy_kind in ('DOMAIN', 'MULTIDOMAIN') then o.policy_domains
        else '{}'::text[] end
 ) as legacy(code)
  join business_domains bd on bd.organization_id = o.organization_id and bd.code = legacy.code
on conflict do nothing;
