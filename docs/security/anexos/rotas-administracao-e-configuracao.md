> **Anexo técnico (em inglês, gerado na auditoria de 08/10/2026).** Descreve as rotas como estavam ANTES das correções — marcações como `scope✗`, `F-n` e "finding" apontam o problema encontrado, não o estado atual. A situação de cada achado está em [../relatorio-de-achados.md](../relatorio-de-achados.md) e as pendências em [../pendencias-e-riscos.md](../pendencias-e-riscos.md).

# INIA backend — admin/configuration route matrix (security audit, 2026-10-08)

Scope: workflows, qa-lab, agents, assistant (orchestrators + conversation monitoring), ai-management, knowledge (admin + materials),
checkpoint-registry, governance, business-domains, channel-flags, argument-scripts, call-expectations, indicator-rules,
indicator-diagnosis (diagnostic strategies), indicators/employee-performance, inia-scenes.

Legend
- `can(P)` = `requirePermission(db, P)` from `src/main/app.ts:173` → `requireAuth` (JWT cookie + DB session check) + `canAnywhere(P)` (permission in ANY scope, `access-decision.ts:26`).
- `can(P, org)` = same with `{ organizationWide: true }` → `canOrganizationWide` (`access-decision.ts:28`).
- `scope✓` = module restricts the object to the caller's manageable scopes via `getManageableScopes` + `canManageScope`/`applyManageableScopeFilter` (`auth/application/manageable-scopes.ts:19-81`).
- `scope✗` = no object-level scope restriction: a GROUP/SUBGROUP-scoped `ADMINISTRADOR` (roles.ts:30-31 grants agents/knowledge/workflows/configuration/data_hub.manage + ai.view at GROUP/SUBGROUP scope) acts on the WHOLE organization.
- `ORG=const` = SQL filters by the hard-coded `00000000-0000-4000-8000-000000000001` (never `request.user.organizationId`). `ORG=session` = filters by the session organization.
- Body limit everywhere: `express.json({ limit: "1mb" })` (`app.ts:145`). Zod objects are non-strict unless noted (unknown keys stripped → no mass assignment found; all INSERT/UPDATE use explicit column lists).
- Lists via `respondList` return ALL rows when `page`/`pageSize` are absent (`list-query.ts:166`); `orderBy` is always a server constant (verified in every caller).
- Non-UUID `:id` params usually reach Postgres → `22P02` → generic `500 INTERNAL_ERROR` (no leak, wrong status).
- Global middleware (app.ts:141-153, read 2026-10-08 while another session was editing it): `helmet()` defaults (CSP `default-src 'self'; script-src 'self'`), CORS to `env.allowedOrigins`, and a NEW uncommitted `createOriginGuard` (src/shared/presentation/origin-guard.ts) that rejects cookie-authenticated writes whose `Origin` is not allowed. Production IIS serves UI and API on ONE origin (deploy/windows/iis/web.config:19-25), so same-origin script passes that guard.

## Workflows — mount `/api/v1/admin/workflows`, `can("workflows.manage")` (app.ts:206)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| workflows/results | GET /:id/results/summary | can | workflows.manage | ORG=session (workflow-results-router.ts:51-54); scope✓ on workflow (57-58) and per person in SQL (workflow-results-reader.ts:131-141) | uuid id (70), dateParam, enum lists, search ≤200 | clean |
| workflows/results | GET /:id/results | can | workflows.manage | same as above | + pagination ≤100 | clean |
| workflows/results | GET /:id/results/:rootEnrollmentId | can | workflows.manage | same; root filtered by org+workflow (reader.ts:118-121) | uuid both ids, pageSize ≤100 | clean |
| workflows | GET / | can | workflows.manage | ORG=const (shared.ts:9, 49); scope✓ `applyManageableScopeFilter` (query-routes.ts:33) | listWorkflowsSchema (query-routes.ts:9-17) | unbounded without page |
| workflows | GET /:id | can | workflows.manage | ORG=const; scope✓ (query-routes.ts:39-42) | none on id | 2nd query by id only (44-47) after check — ok |
| workflows | POST / | can | workflows.manage | ORG=const; scope✓ on body scope (definition-routes.ts:86-89); trigger flag/indicator checked in ORG=const (62-78) | name min2/no max, description no max, scopeType enum, uuids | SUBTEAM accepts arbitrary `teamId` (only subteamId is scope-checked; DB check 022_workflows.sql:16-20 allows it) — benign at runtime |
| workflows | POST /schedule-preview | can | workflows.manage | ORG=const; **scope✗ on `input.scope.teamId`** (definition-routes.ts:129-133) | trigger schema | returns up to 5 operator names + counts of ANY team (159-169) → F-09 |
| workflows | PATCH /:id | can | workflows.manage | ORG=const; scope✓ current (184-188) and target (193-195); orchestrators re-validated on scope move (203-229), anchors (233-256) | updateWorkflowSchema | CALL_AGENT agents NOT re-validated on scope move; `active` toggled here |
| workflows | PUT /:id/draft | can | workflows.manage | ORG=const; scope✓ (lifecycle-routes.ts:41-44) | flowGraphSchema (graph-schema.ts:574-578) — no node/edge count limit, `wait.durationMs` unbounded | references validated only at publish |
| workflows | PUT /:id/analysis-config | can | workflows.manage | ORG=const; scope✓ (64-67); anchors in scope (88-96, 107-115) | discriminated union | clean |
| workflows | POST /:id/validate | can | workflows.manage | ORG=const; scope✓ (135-138) | — | dry-run of publish |
| workflows | POST /:id/publish | can | workflows.manage | ORG=const; scope✓ (150-153); orchestrators scope-compatible (publish-validation/orchestrators.ts:28); **agents only org/active (publish-validation/actions.ts:172-177)**; USER/SPECIFIC_USER targets not validated | — | F-08, F-10 |
| workflows | DELETE /:id | can | workflows.manage | ORG=const; scope✓ (178-183) | — | hard delete |
| workflows | GET /:id/enrollments | can | workflows.manage | ORG=const; scope✓ (enrollment-routes.ts:39-42); children by workflow_id | status enum, dates, search | default pageSize 50 |
| workflows | POST /:id/enrollments/:enrollmentId/decision | can | workflows.manage | scope✓ (63-66); enrollment must belong to workflow (submit-human-review-decision.ts:29-31) | nodeId min1, decision enum | admin can decide in place of the designated reviewer (by design) |
| workflows/manual | GET /:id/manual-run | can | workflows.manage | ORG=const; scope✓ (manual-run-routes.ts:27-35) | — | clean |
| workflows/manual | GET /:id/manual-run/collaborators | can | workflows.manage | scope✓ + per-person `canAccess` (19-25; manual-run.ts:143) | search ≤120 | clean |
| workflows/manual | GET /:id/manual-run/interactions | can | workflows.manage | `assertCollaboratorAllowed` (manual-run.ts:152-170) | uuid, search ≤120 | clean |
| workflows/manual | GET /:id/manual-run/measurements | can | workflows.manage | same | uuid | clean |
| workflows/manual | POST /:id/manual-runs | can | workflows.manage | scope + eligibility; interaction/measurement ownership (manual-run.ts:274-297); idempotency per requester (306-318) | uuids, idempotencyKey 8-120 | clean |
| workflows/manual | GET /:id/manual-runs/:runId | can | workflows.manage | run filtered by workflow+org (manual-run.ts:548) | — | clean |
| workflows/vars | GET /:id/variables | can | workflows.manage | scope✓ (variable-routes.ts:28-31); by workflow_id | — | clean |
| workflows/vars | POST /:id/variables | can | workflows.manage | scope✓ (42-45) | createWorkflowVariableSchema | clean |
| workflows/vars | PATCH /:id/variables/:variableId | can | workflows.manage | scope✓; `where id and workflow_id` (62) | update schema | clean |
| workflows/vars | DELETE /:id/variables/:variableId | can | workflows.manage | scope✓; `where id and workflow_id` (92) | — | in-use guard |

## QA Lab — mount `/api/v1/admin/qa-lab`, `can("qa_lab.use", org)` (app.ts:219)

Only ADMINISTRADOR_GERAL holds `qa_lab.use` (roles.ts:21). Application layer uses ORG=const (qa-run-repository.ts:10, test-data-finders.ts:13, interaction-evidence.ts:12, run-agent-simulation.ts:12, run-orchestrator-simulation.ts:11, build-simulated-enrollment.ts:17).

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| qa-lab | GET /test-data/interactions | can org | qa_lab.use | ORG=const | findInteractionsSchema | org admin only |
| qa-lab | GET /test-data/workflows/:workflowId/interactions | can org | qa_lab.use | ORG=const | uuid | — |
| qa-lab | GET /test-data/interactions/:id | can org | qa_lab.use | ORG=const | uuid | returns transcripts (intended) |
| qa-lab | GET /test-data/measurements | can org | qa_lab.use | ORG=const | schema | — |
| qa-lab | GET /test-data/people | can org | qa_lab.use | ORG=const | schema | — |
| qa-lab | POST /test-data/condition-preview | can org | qa_lab.use | ORG=const | previewConditionSchema | — |
| qa-lab | POST /runs/workflow | can org | qa_lab.use | ORG=const | workflowSimulationInputSchema (uuids) | real LLM spend possible |
| qa-lab | POST /runs/agent | can org | qa_lab.use | ORG=const | agentId uuid, input no max | — |
| qa-lab | POST /runs/orchestrator | can org | qa_lab.use | ORG=const | uuids, instruction no max | — |
| qa-lab | GET /runs | can org | qa_lab.use | ORG=const | listQaRunsSchema | — |
| qa-lab | GET /runs/:id | can org | qa_lab.use | ORG=const (qa-run-repository.ts:186-188) | id not validated → 500 on non-uuid | — |
| qa-lab | POST /runs/:id/resume | can org | qa_lab.use | ORG=const | qaRunResumeSchema | — |
| qa-lab | POST /runs/:id/decision | can org | qa_lab.use | ORG=const | qaRunDecisionSchema | — |
| qa-lab | POST /runs/:id/rerun | can org | qa_lab.use | ORG=const | stored input re-parsed | — |
| qa-lab | POST /runs/:id/rerun-current | can org | qa_lab.use | ORG=const | stored input re-parsed | — |

## Agents — mount `/api/v1/admin/agents`, `can("agents.manage")` (app.ts:192); ORG=const (agent-router.ts:15)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| agents | GET / | can | agents.manage | scope✓ filter (agent-router.ts:305, 315) | listAgentsSchema | unbounded without page |
| agents | GET /:id | can | agents.manage | scope✓ (321-324) | — | — |
| agents | GET /:id/history | can | agents.manage | scope✓ (331-334) | — | — |
| agents | GET /:id/runs | can | agents.manage | scope✓ (347-350) | — | returns input_context/output_text (transcripts), limit 50 |
| agents | GET /:id/preview-prompt | can | agents.manage | scope✓ (365-368) | — | — |
| agents | POST /:id/test | can | agents.manage | scope✓ (380-383) | input min10, no max | paid LLM call, no rate limit |
| agents | POST / | can | agents.manage | scope✓ body scope (393-396); **KB ids only checked org+not deleted (255-266), not KB scope**; prohibitedTopicIds unvalidated (278-285) | agentTextSchema limits (agent-field-limits.ts:12-18); arrays unbounded | F-07 |
| agents | PATCH /:id | can | agents.manage | scope✓ current + target (465-475); same KB gap | update schema | F-07 |
| agents | DELETE /:id | can | agents.manage | scope✓ (580-584) | — | — |

## Orchestrators — mount `/api/v1/admin/assistant-orchestrators`, `can("agents.manage")` (app.ts:207); ORG=const (assistant-router.ts:22)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| assistant | GET / | can | agents.manage | scope✓ filter (251, 262) | listOrchestratorsSchema | — |
| assistant | GET /:id | can | agents.manage | scope✓ (268-271) | — | — |
| assistant | GET /:id/structured-output-usage | can | agents.manage | scope✓ (278-281) | — | — |
| assistant | POST / | can | agents.manage | scope✓ body (288-291); orchestrator agent + specialists scope-compatible (validateAgentsCompatibleWithScope 133-150); domains via catalog | name no max, outputInstructions no max, structuredOutput parsed | agents lookup `where id = any($1)` without org (139-141) — ok single-tenant |
| assistant | PATCH /:id | can | agents.manage | scope✓ current+target (343-352); specialists re-validated on scope move (360-363) | update schema | clean |
| assistant | DELETE /:id | can | agents.manage | scope✓ (461-466) | — | — |

## Conversation monitoring — mount `/api/v1/admin/assistant-conversations`, `can("assistant_conversations.view")` (app.ts:209)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| assistant/monitoring | GET / | can | assistant_conversations.view | ORG=session; per-assignment scope in SQL (conversation-monitoring.ts:18-34) | search ≤100, uuids, pageSize ≤50 | clean |
| assistant/monitoring | GET /:conversationId | can | assistant_conversations.view | same filter + id (134-140) | uuid | clean |
| assistant/monitoring | GET /:conversationId/messages | can | assistant_conversations.view | same + messages by conversation/org | limit ≤100, cursors ≤200 | clean |

## AI management — mount `/api/v1/admin/ai` (app.ts:217), `requireAuth` + in-router `aiPermissionsFor` (ai-management-router.ts:36-49; ai-permissions.ts:13-17)

`ai.manage` org-wide → all AI_* perms; `ai.view` (scoped ADMINISTRADOR) → AI_CONFIG_READ + AI_USAGE_READ. All services filter by session org; ids parsed with `z.uuid()`.

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| ai | GET /me | auth | any | — | — | — |
| ai | GET /providers, /use-cases, /legacy | auth | AI_CONFIG_READ | static | — | legacy summary has no secrets (ai-policy-service.ts:50-58) |
| ai | GET /overview, /usage, /health | auth | AI_USAGE_READ | ORG=session | usage period ≤1y | org-wide numbers visible to scoped admins (design) |
| ai | GET /connections, /connections/:id | auth | AI_CONFIG_READ | ORG=session (ai-connection-service.ts:132-142) | uuid | secrets never returned; mask = last 4 chars if ≥16 (ai-secrets.ts:28-31) |
| ai | POST /connections | auth | AI_CONFIG_WRITE (+SECRETS if apiKey/headers) | ORG=session | connectionCreateSchema (39-52); baseUrl `endpointProblem` only | F-11 SSRF |
| ai | PATCH /connections/:id | auth | AI_CONFIG_WRITE | ORG=session | connectionPatchSchema | baseUrl change keeps stored key (200-216) → F-12 |
| ai | DELETE /connections/:id | auth | AI_CONFIG_WRITE | ORG=session | uuid | in-use guard |
| ai | PUT/DELETE /connections/:id/secret, PUT /connections/:id/headers | auth | AI_SECRETS_WRITE | ORG=session | apiKey 4-4000; header names regex + denylist (ai-secrets.ts:36-40) | `Metadata-Flavor` etc. allowed |
| ai | POST /connections/:id/test, /sync-models | auth | AI_CONFIG_WRITE | ORG=session | uuid | server-side fetch to stored baseUrl, redirects followed |
| ai | GET/POST /models, GET/PATCH/DELETE /models/:id, POST /models/:id/test, GET/POST /models/:id/pricing | auth | READ / WRITE | ORG=session; connection ownership on create (ai-model-service.ts:194) | uuid; schemas | test returns 200-char output preview |
| ai | GET /routing, PUT/DELETE /routing/:useCase/draft, POST activate/deactivate | auth | READ / WRITE | ORG=session; model ownership (ai-policy-service.ts:115-117) | useCase regex | clean |
| ai | POST /routing/:useCase/test | auth | AI_CONFIG_READ | ORG=session | strict-ish body | plan only, no provider call |
| ai | GET/POST/PUT/DELETE /budgets[/:id] | auth | USAGE_READ / BUDGET_WRITE | ORG=session (ai-budget-service.ts:57-83) | uuid | clean |

## Knowledge (admin) — mount `/api/v1/admin/knowledge`, `can("knowledge.manage")` (app.ts:187); ORG=const (knowledge-router.ts:16); **no scope logic anywhere in the router**

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| knowledge | GET / | can | knowledge.manage | ORG=const; **scope✗** | listKnowledgeSchema | lists every KB incl. drafts/other teams — F-02 |
| knowledge | GET /:id | can | knowledge.manage | ORG=const; **scope✗** (168-172) | none | full latest content |
| knowledge | GET /:id/file | can | knowledge.manage | ORG=const; **scope✗** (176-198) | none | **serves stored client MIME inline** (190-191) — F-01 |
| knowledge | GET /:id/preview | can | knowledge.manage | ORG=const; **scope✗** | none | mammoth HTML per request; frontend sanitizes |
| knowledge | POST / (multipart `file`) | can | knowledge.manage | ORG=const; **scope✗ on orgScopes** (replaceScopes 110-136) | multer 15 MB (17); type = client MIME→fallback TXT (text-extractor.ts:13-20); orgScopes/subjectScopes arrays unbounded; title no max | F-01, F-02, F-13 |
| knowledge | PATCH /:id | can | knowledge.manage | ORG=const; **scope✗**; does not exclude soft-deleted docs (296) | updateKnowledgeSchema; content no max (≤1mb body) | can PUBLISH + set ALL_TEAMS; triggers checkpoint sync that `/checkpoints/.../extract` reserves to org-wide (339-345) |
| knowledge | DELETE /:id | can | knowledge.manage | ORG=const; **scope✗** | none | soft delete of any KB |

## Knowledge materials (reader) — mount `/api/v1/knowledge-materials`, `requireAuth` (app.ts:191)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| knowledge-materials | GET /:id | auth | any authenticated | ORG=session; reader scope SQL (knowledge-material-access.ts:34-62, 100-117) | uuid regex | clean |
| knowledge-materials | GET /:id/file | auth | any authenticated | same | uuid | **stored client MIME, inline by default** (knowledge-material-router.ts:43-44) — F-01 |
| knowledge-materials | GET /:id/preview | auth | any authenticated | same | uuid | mammoth conversion on every request (52-69) — F-13 amplification |

## Checkpoint registry — mount `/api/v1/admin/checkpoints`, `can("knowledge.manage")` (app.ts:189); ORG=session

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| checkpoints | GET /documents, /documents/:documentId, /definitions/:definitionId, /scope-options | can | knowledge.manage (any scope) | ORG=session | ids unvalidated | reads are org-wide for scoped admins (documented intent) |
| checkpoints | POST /documents/:documentId/extract, /documents/:documentId/governance, /change-sets/:id/approve-proposed, /versions/:id/approve, /versions/:id/reject, /versions/:id/link, /versions/:id/acknowledge-removal, PATCH /definitions/:id, PUT /definitions/:id/scopes | can + `requireOrganizationWide` (checkpoint-registry-router.ts:23-25) | knowledge.manage org-wide | ORG=session on every lookup (checkpoint-registry-service.ts:147, 177, 228, 250, 264) | `.strict()` schemas (15-18); definitionConfigSchema strict | clean |

## Governance — mount `/api/v1/admin` (catch-all), `can("configuration.manage")` (app.ts:225); ORG=const (governance-router.ts:6)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| governance | GET /prohibited-topics | can | configuration.manage | ORG=const | search/active | — |
| governance | POST /prohibited-topics | can | configuration.manage | ORG=const; **scope✗ (tenant-wide resource)** | name min2/no max | feeds EVERY agent prompt (build-system-prompt.ts:101) — F-04 |
| governance | PATCH /prohibited-topics/:id | can | configuration.manage | ORG=const in WHERE (35); **scope✗** | id unvalidated → 500 | can deactivate org-wide guardrails — F-04 |
| governance | GET /glossary | can | configuration.manage | ORG=const | — | — |
| governance | POST /glossary | can | configuration.manage | ORG=const; **scope✗** | no max | feeds retrieval (retrieve-knowledge.ts:261) — F-04 |
| governance | PATCH /glossary/:id | can | configuration.manage | ORG=const in WHERE; **scope✗** | — | F-04 |

## Business domains — mount `/api/v1/admin/business-domains`, `can("configuration.manage")` (app.ts:194); ORG=const (business-domain-router.ts:24)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| business-domains | GET / , GET /:id | can | configuration.manage | ORG=const | listSchema; id unvalidated | — |
| business-domains | GET /:id/dependencies | can | configuration.manage | ORG=const; **scope✗** | — | lists ids/names of agents/orchestrators of all teams (business-domain-service.ts:45-58) |
| business-domains | POST / , PATCH /:id, POST /:id/activate, POST /:id/deactivate, DELETE /:id | can | configuration.manage | ORG=const in every WHERE (service 81-152); **scope✗ (tenant-wide catalog)** | code regex/name via businessDomainInputSchema | F-04; 409 `details.dependencies` leaks other teams' agents |

## Channel flags — mount `/api/v1/admin/channel-flags`, `can("configuration.manage")` (app.ts:205); ORG=const (channel-flag-router.ts:8)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| channel-flags | GET /, GET /channels | can | configuration.manage | ORG=const | list schema | — |
| channel-flags | POST / | can | configuration.manage | ORG=const; **scope✗** | channel/flagName min2 no max; description no max | F-04 |
| channel-flags | PATCH /:id | can | configuration.manage | ORG=const in WHERE (97); **scope✗** | — | rename/deactivate flags used by other teams' triggers — F-04 |
| channel-flags | DELETE /:id | can | configuration.manage | ORG=const; **scope✗** | — | FK guard |

## Argument scripts — mount `/api/v1/admin/argument-scripts`, `can("configuration.manage")` (app.ts:202); ORG=session

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| argument-scripts | GET /scope-options, GET /, GET /:id | can | configuration.manage | scope✓ visibility (argument-script-service.ts:107-112, 152-160) | listQuerySchema | clean |
| argument-scripts | POST /, PATCH /:id, DELETE /:id/draft, POST /:id/publish, /archive, /reactivate, DELETE /:id | can | configuration.manage | scope✓ `requireEditable` (161-165) + `resolveScope` (191-217; team/subteam checked against org) | service schemas | sourceDocumentId any KB in org (238-243) — minor |

## Call expectations (legacy, read-only) — mount `/api/v1/admin/call-expectations`, `can("configuration.manage")` (app.ts:203); ORG=const

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| call-expectations | GET / | can | configuration.manage | ORG=const; scope✗ (all teams visible) | list schema | low sensitivity |
| call-expectations | POST /, PATCH /:id, DELETE /:id | can | configuration.manage | — | — | always 410 |

## Indicator rules / catalog — mount `/api/v1/admin/indicator-rules`, `can("configuration.manage")` (app.ts:197); ORG=const (indicator-rule-router.ts:18)

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| indicator-rules | GET /, GET /catalog, GET /definitions/:id/dependencies | can | configuration.manage | ORG=const | list schema | — |
| indicator-rules | POST /definitions, PATCH /definitions/:id, DELETE /definitions/:id | can | configuration.manage | ORG=const; **scope✗ (tenant-wide catalog)** | indicatorDefinition schemas; semantic lock | F-04 |
| indicator-rules | POST / (calculation rule) | can | configuration.manage | ORG=const; **scope✗: any scopeType/teamId/subteamId accepted** (145-172); indicatorDefinitionId not checked to be in org | calculationMethod min5 no max | F-04 |
| indicator-rules | PATCH /:ruleId, DELETE /:ruleId | can | configuration.manage | ORG=const in WHERE; **scope✗** | — | F-04 |
| indicator-rules | PUT /glossary | can | configuration.manage | ORG=const; indicatorDefinitionId not checked to be in org (205-225); **scope✗** | min5 no max | feeds indicator feedback prompts — F-04 |

## Diagnostic strategies — mount `/api/v1/admin/indicator-diagnostic-strategies`, `can("configuration.manage")` (app.ts:199); ORG=session

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| diagnostic-strategy | GET /indicators/:indicatorId | can | configuration.manage | ORG=session | — | read for any scope (intended) |
| diagnostic-strategy | PUT /indicators/:id/draft, POST /publish, DELETE /draft, POST /active | can + requireOrganizationWide (33-35) | configuration.manage org-wide | ORG=session | config parsed in service | clean |
| diagnostic-strategy | GET /indicators/:id/simulation-options | can | configuration.manage | ORG=session; people scope✓ (92-94); agents list org-wide (123) | search ≤80 | minor: leaks all agent names/ids |
| diagnostic-strategy | POST /indicators/:id/simulate | can | configuration.manage | collaborator scope✓ (130); measurement bound to collaborator (simulate-diagnostic-strategy.ts:55); **agentId any agent in org** (57) | uuids, aiPolicy enum | `aiPolicy: "REAL"` → paid LLM calls by any scoped config admin |

## Employee performance — mount `/api/v1/admin/employee-performance`, `can("configuration.manage")` (app.ts:200); ORG=const

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| employee-performance | GET / | can | configuration.manage | ORG=const; **scope✗** (employee-performance-router.ts:21-43) | `personId` unvalidated (17) → 500 on non-uuid | returns achievement/weight/PRV/quartile of every employee, unbounded — F-03 |

## INIA scenes

| module | method path | guard | permission | tenant/object check | validation | notes |
|---|---|---|---|---|---|---|
| inia-scenes admin | GET / | can org (app.ts:215) | inia_experience.manage org-wide | ORG=session | — | clean |
| inia-scenes admin | POST / (multipart) | can org | inia_experience.manage | ORG=session | `.strict()` (inia-scene-router.ts:46); multer limits size/files/fields/fieldSize (13-20); image bytes validated, MIME derived server-side (inia-scene-service.ts:241-248) | clean |
| inia-scenes admin | PATCH /:id, DELETE /:id, PUT /default | can org | inia_experience.manage | ORG=session; uuid ids (105-109) | `.strict()`; manifest ≤N images (55-58) | clean |
| inia-scenes | GET /current | requireAuth (app.ts:183) | any | ORG=session | — | clean |
| inia-scenes | GET /images/:imageId, GET /:id/image | requireAuth | any | ORG=session (inia-scene-service.ts:424, 430) | uuid | response has `nosniff` + `CSP default-src 'none'` (161-162) — the pattern the KB file routes lack |
