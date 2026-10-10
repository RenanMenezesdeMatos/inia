-- Evolução da taxonomia de Agents × Orchestrators (2026-09-16) — migration ADITIVA.
--
-- Auditoria (docs/dev/auditoria-agents-orchestrators-2026-09.md): `policy_kind` misturava quatro
-- perguntas (fronteira de coordenação, especialidade do Agent, ponto do grafo, onde é acionado) e
-- `agents.specialty` misturava o TIPO de especialidade com o DOMÍNIO. Modelo alvo:
--
--   AGENT        specialty_kind ∈ DOMAIN | CROSS_CUTTING | PERFORMANCE | SYNTHESIS
--                domain (só DOMAIN), capability (só CROSS_CUTTING), consolidated_input (aceita o
--                resultado consolidado pós-JOIN — obrigatório para SYNTHESIS)
--   ORCHESTRATOR routing_policy ∈ DOMAINS | OPEN  +  routing_domains (1..N quando DOMAINS)
--                invocation_mode continua respondendo ONDE é acionado.
--
-- Compatibilidade (ADD → BACKFILL → COMPATIBILITY → MIGRATE USAGE → VERIFY → DEPRECATE):
-- - NADA é removido ou renomeado: `agents.specialty` e `assistant_orchestrators.policy_kind/
--   policy_domains` continuam existindo e sendo escritos (dual-write) enquanto o runtime lê os dois
--   (dual-read, novo primeiro — agents/domain/agent-specialty.ts, assistant/domain/orchestrator-policy.ts).
-- - Backfill DETERMINÍSTICO, sem inferência: specialty FATURAMENTO/RETENCAO/SUPORTE/CADASTRO →
--   DOMAIN + domain; CROSS_CUTTING → CROSS_CUTTING; PERFORMANCE → PERFORMANCE. policy_kind
--   DOMAIN/MULTIDOMAIN → DOMAINS + routing_domains = policy_domains; INTERACTIVE → OPEN.
--   TRANSVERSAL e MANAGERIAL ficam SEM routing_policy (legado lido pelo dual-read) até os
--   Workflows pós-JOIN migrarem para o Agent de síntese.
-- - `policy_kind` ganha o valor 'OPEN' para o dual-write de um Orquestrador OPEN fora do chat
--   (o legado INTERACTIVE só existe com invocation_mode INTERACTIVE — constraint da 054).
-- - Constraints novas só sobre o que o backfill garante: DOMAINS ⇒ pelo menos um domínio;
--   SYNTHESIS ⇒ consolidated_input.
-- - Registros inativos sem política (TESTE-*) continuam válidos como legado auditável.
--
-- Rollback de runtime: enquanto as colunas legadas forem escritas, voltar o código para a versão
-- anterior (que só lê specialty/policy_kind) continua funcionando — as colunas novas ficam ignoradas.
alter table agents drop constraint if exists agents_specialty_check;
alter table agents
  add constraint agents_specialty_check
    check (specialty in ('FATURAMENTO', 'RETENCAO', 'SUPORTE', 'CADASTRO', 'CROSS_CUTTING', 'PERFORMANCE', 'SYNTHESIS'));

alter table agents
  add column if not exists specialty_kind text
    check (specialty_kind in ('DOMAIN', 'CROSS_CUTTING', 'PERFORMANCE', 'SYNTHESIS')),
  add column if not exists domain text
    check (domain in ('FATURAMENTO', 'RETENCAO', 'SUPORTE', 'CADASTRO')),
  add column if not exists capability text,
  add column if not exists consolidated_input boolean not null default false;

update agents
   set specialty_kind = case
         when specialty in ('FATURAMENTO', 'RETENCAO', 'SUPORTE', 'CADASTRO') then 'DOMAIN'
         when specialty = 'CROSS_CUTTING' then 'CROSS_CUTTING'
         when specialty = 'PERFORMANCE' then 'PERFORMANCE'
         when specialty = 'SYNTHESIS' then 'SYNTHESIS'
       end,
       domain = case when specialty in ('FATURAMENTO', 'RETENCAO', 'SUPORTE', 'CADASTRO') then specialty end,
       consolidated_input = consolidated_input or specialty = 'SYNTHESIS',
       updated_at = now()
 where specialty is not null and specialty_kind is null;

alter table agents drop constraint if exists agents_specialty_kind_domain;
alter table agents
  add constraint agents_specialty_kind_domain
    check ((specialty_kind = 'DOMAIN') = (domain is not null) or specialty_kind is null);

alter table agents drop constraint if exists agents_synthesis_requires_consolidated;
alter table agents
  add constraint agents_synthesis_requires_consolidated
    check (specialty_kind <> 'SYNTHESIS' or consolidated_input);

alter table assistant_orchestrators drop constraint if exists assistant_orchestrators_policy_kind_check;
alter table assistant_orchestrators
  add constraint assistant_orchestrators_policy_kind_check
    check (policy_kind in ('DOMAIN', 'TRANSVERSAL', 'MULTIDOMAIN', 'MANAGERIAL', 'INTERACTIVE', 'OPEN'));

alter table assistant_orchestrators
  add column if not exists routing_policy text
    check (routing_policy in ('DOMAINS', 'OPEN')),
  add column if not exists routing_domains text[] not null default '{}';

update assistant_orchestrators
   set routing_policy = case
         when policy_kind in ('DOMAIN', 'MULTIDOMAIN') then 'DOMAINS'
         when policy_kind in ('INTERACTIVE', 'OPEN') then 'OPEN'
       end,
       routing_domains = case when policy_kind in ('DOMAIN', 'MULTIDOMAIN') then policy_domains else '{}' end,
       updated_at = now()
 where routing_policy is null and policy_kind in ('DOMAIN', 'MULTIDOMAIN', 'INTERACTIVE', 'OPEN');

alter table assistant_orchestrators drop constraint if exists assistant_orchestrators_routing_domains_required;
alter table assistant_orchestrators
  add constraint assistant_orchestrators_routing_domains_required
    check (routing_policy is distinct from 'DOMAINS' or cardinality(routing_domains) >= 1);
