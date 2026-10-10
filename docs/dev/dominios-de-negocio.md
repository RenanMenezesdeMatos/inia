# Domínios de negócio — catálogo administrável (2026-09-16)

Regra arquitetural: a aplicação conhece **tipos** (`DOMAIN | CROSS_CUTTING | PERFORMANCE | SYNTHESIS`; `DOMAINS | OPEN`) — nunca domínios concretos. `FATURAMENTO`, `RETENCAO`, `SUPORTE`, `CADASTRO`, `LOGISTICA`… são **dados** de `business_domains`. Novo domínio = registro no catálogo (tela `Administração → Atendimento com IA → Domínios de negócio`), sem migration, enum, alteração TypeScript ou deploy.

Domínio ≠ Grupo (estrutura organizacional), ≠ Base de Conhecimento (vinculada ao Agent), ≠ Agent (um domínio pode ter N Agents).

## Schema (migration 060, aditiva)

| Objeto | Papel |
| --- | --- |
| `business_domains(id, organization_id, code, name, description, active, created_at, updated_at)` | Fonte de verdade. `unique(organization_id, code)`; `code ~ '^[A-Z][A-Z0-9_]{1,39}$'`. |
| `agents.business_domain_id` (FK) | Agent `specialty_kind = DOMAIN` → domínio. |
| `assistant_orchestrator_domains(orchestrator_id, business_domain_id)` (PK composta, cascade no orquestrador) | Orquestrador `routing_policy = DOMAINS` → 1..N domínios. |
| Check constraints relaxadas | `agents.domain` e `agents.specialty` deixam de listar os 4 códigos e passam a validar só o **formato** de código — sem isso um domínio novo não poderia ser dual-escrito. |

Backfill determinístico e idempotente: os 4 códigos viram registros em toda organização; `agents.business_domain_id` pelo código de `agents.domain`; relação do orquestrador a partir de `routing_domains` (ou `policy_domains` no legado sem `routing_policy`). Nada é inferido de nomes de Grupos/Agents/KBs.

## Dual-read / dual-write (fase de compatibilidade)

| Campo legado | Ainda é escrito? | Quem ainda lê | Removível quando |
| --- | --- | --- | --- |
| `agents.specialty` (053) | Sim — código do domínio ou `CROSS_CUTTING/PERFORMANCE/SYNTHESIS` (`legacySpecialtyFor`) | Fallback de `resolveAgentSpecialty` quando `specialty_kind` é null; fixture `official-ai-catalog.json`; API devolve o campo | Nenhum agente com `specialty_kind` null; frontend/fixtures pararem de ler `specialty` |
| `agents.domain` (057) | Sim — código do domínio (`agent-router.ts`) | Fallback de `resolveDomainRef` quando não há FK/join | Todos os agentes DOMAIN com `business_domain_id` (backfill já garante) e nenhum leitor de `domain` |
| `assistant_orchestrators.routing_domains` (057) | Sim — códigos (`persistedPolicyColumns`) | Fallback de `resolveDomainRefs` quando a relação está vazia; constraint 057 (`DOMAINS ⇒ ≥1 código`) | Constraint migrar para a relação e nenhum leitor dos códigos |
| `assistant_orchestrators.policy_kind/policy_domains` (053/054) | Sim — `legacyPolicyFor` (DOMAIN/MULTIDOMAIN/INTERACTIVE/OPEN + códigos) | Dual-read de `resolveRoutingPolicy` para registros sem `routing_policy` (TRANSVERSAL/MANAGERIAL); constraint 054 ("ativo ⇒ política") | Após reclassificar/desativar os legados TRANSVERSAL/MANAGERIAL e mover a constraint 054 para `routing_policy` |

Resolvers centrais (únicos pontos que entendem as duas formas):

- `backend/src/modules/business-domains/domain/business-domain.ts` — `resolveDomainRef` (1 referência) e `resolveDomainRefs` (N), relação/FK primeiro, código legado como fallback (nome = código, `id = null`).
- `agents/domain/agent-specialty.ts` — `resolveAgentSpecialty` (domínio como `BusinessDomainRef`).
- `assistant/domain/orchestrator-policy.ts` — `resolveRoutingPolicy` / `parseOrchestratorPolicy`; comparação de fronteira **por código**, mensagens com o **nome**.
- Frontend espelha em `schemas/admin/business-domain.schema.ts` e `schemas/admin/orchestrator-policy.ts`.

SQL só em `business-domains/application/business-domain-lookup.ts` (fragmentos de join/json + `resolveBusinessDomainRefs` + `assertBusinessDomainsSelectable` + `syncOrchestratorBusinessDomains`) e `business-domain-service.ts` (CRUD, dependências, audit). Consumidores nunca consultam `business_domains` por conta própria.

## API

`/api/v1/admin/business-domains` (ADMIN): `GET /` (só ativos por padrão; `includeInactive=true`, `active=`, `search=`, paginação padrão), `GET /:id`, `GET /:id/dependencies`, `POST /`, `PATCH /:id`, `POST /:id/activate`, `POST /:id/deactivate`, `DELETE /:id`.

Códigos de erro: `BUSINESS_DOMAIN_NOT_FOUND` (404 no catálogo; 422 quando referenciado por Agent/Orquestrador), `BUSINESS_DOMAIN_CODE_TAKEN` (409), `BUSINESS_DOMAIN_CODE_LOCKED` (409 — código em uso), `BUSINESS_DOMAIN_IN_USE` (409 — exclusão), `BUSINESS_DOMAIN_INACTIVE` (422 — domínio desativado em configuração nova). Agent: `businessDomainId` (novo) ou `domain` (código, compat). Orquestrador: `routingDomainIds` (novo) ou `routingDomains`/`policyDomains` (códigos, compat). Audit trail em `audit_logs` (`entity_type = business_domain`, ações `BUSINESS_DOMAIN_CREATED/UPDATED/ACTIVATED/DEACTIVATED/DELETED`).

## Provas

- `INIA_DB_PROOF=1 npx vitest run business-domain-proof` — banco de teste real: cria `LOGISTICA_QA` pela API, Agent DOMAIN, Orquestrador DOMAINS, política (422 fora da fronteira; ok ao ampliar), dependências, 409 em exclusão/código, desativação (existente sobrevive, novo recusado), audit, limpeza; e garante que `LOGISTICA_QA` não existe no código-fonte.
- Suíte normal: `business-domain.test.ts` (código/normalização/dual-read), `business-domain-router.test.ts` (CRUD com banco fake), `agent-router.test.ts`/`assistant-router.test.ts` (validação e dual-write), `orchestrator-policy.test.ts` (fronteira com domínio dinâmico), frontend `business-domains-page.test.tsx`, `orchestrator-policy-fields.test.tsx`, `orchestrator-policy.test.ts`.
