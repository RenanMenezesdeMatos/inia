> **Anexo técnico (em inglês, gerado na auditoria de 08/10/2026).** Descreve as rotas como estavam ANTES das correções — marcações como `scope✗`, `F-n` e "finding" apontam o problema encontrado, não o estado atual. A situação de cada achado está em [../relatorio-de-achados.md](../relatorio-de-achados.md) e as pendências em [../pendencias-e-riscos.md](../pendencias-e-riscos.md).

# INIA backend — route matrix (user-data modules)

Audit date: 2026-10-08. Read-only review of `backend/src`. Mount points from `src/main/app.ts:111-186`.

Legend: **RA** = `requireAuth` (JWT cookie + DB check on `user_accounts.active` / `session_version` / pending password change, `require-auth.ts:20-52`). **can(p)** = `requirePermission(p)` = RA + permission held in ANY scope (`require-permission.ts:21-35`). "ORG(hard)" = SQL uses the hardcoded `00000000-0000-4000-8000-000000000001` instead of `request.user.organizationId`. "F-n" points to a finding in the final report.

| Module | Method + path | Guard | Permission | Object / tenant check | Validation | Notes |
|---|---|---|---|---|---|---|
| auth | POST /api/v1/auth/login | none | — | Lookup by global unique `lower(email)` (`postgres-credential-store.ts:29-37`) | zod email, password ≤1024 | Per-identifier throttle 5/15 min, not atomic, no per-IP limit (F-15). Inactive *person* with active account can log in (F-9). |
| auth | POST /api/v1/auth/logout | none | — | — | — | Only clears the cookie; `session_version` not bumped, so the JWT stays valid until expiry (F-15). |
| auth | POST /api/v1/auth/password | RA (allows pending change) | own account | account = JWT `sub`+org; requires `password_change_required` (`define-first-password.ts:22-25`); optimistic on `session_version` | strict zod; policy (8+, letter, digit, ≤72 bytes, no login) | OK. |
| auth | GET /api/v1/auth/me | RA (allows pending change) | own | live identity + live access (`auth-router.ts:80-99`) | — | OK. Echoes the JWT snapshot (`role`, `teamId`) along with live data. |
| access | GET /api/v1/admin/access/roles | RA | access.roles.view (in service, `access-service.ts:86`) | catalog only | — | OK. |
| access | GET /admin/access/scope-options | RA | access.roles.assign (`access-service.ts:97`) | teams/subteams filtered by visibility + org | — | OK. |
| access | GET /admin/access/users | RA | access.users.view (`account-access-service.ts:57`) | `p.organization_id=$1` + team/subteam visibility (`postgres-account-access-repository.ts:89`) | page/pageSize ≤100, search ≤100, status enum | OK. Returns email, matricula, temp-password timestamps for people in scope. |
| access | POST /admin/access/users/:personId/enable | RA | access.users.manage + scope reach + custody (`account-access-service.ts:31-43`) | org-filtered target (`:113-116`) | uuid; strict `{email}` | Custody ignores implicit reports_to (leader) authority; puppet accounts get around the self-assignment ban (F-4). |
| access | POST /admin/access/accounts/:accountId/temporary-password | RA | access.users.manage + reach + custody | org-filtered; optimistic `session_version` | uuid | Same as above (F-4). `Cache-Control: no-store`. |
| access | POST /admin/access/accounts/:accountId/disable | RA | access.users.manage + reach + custody | org-filtered; last-tenant-admin guard (not atomic, F-14) | uuid | OK apart from F-14. |
| access | GET /admin/access/accounts | RA | access.users.view | org + visibility | page ≤100, search ≤100 | Per-row `listAssignments` (N+1, bounded by pageSize). |
| access | GET /admin/access/accounts/:accountId | RA | access.users.view + reach (`access-service.ts:71-80`) | org + reach → 404 | uuid | OK. |
| access | POST /admin/access/accounts/:accountId/roles | RA | access.roles.assign + `checkDelegation` (role delegable, scope covered, recipient reached, no self) | scope resolved in DB per org (`postgres-access-repository.ts:67-77`) | strict zod; uuid | OK. Delegation logic is sound; see F-4 for the puppet-account bypass. |
| access | POST /admin/access/roles/:roleCode/grant-to-leaders | RA | access.roles.assign; MY_STRUCTURE only from ORGANIZATION-scope grantors | org + visibility | regex roleCode | OK. |
| access | DELETE /admin/access/accounts/:accountId/roles/:assignmentId | RA | delegation (allowSelf) | org-filtered; assignment must belong to the account | uuid ×2; strict `{reason}` | Last-tenant-admin check not atomic (F-14). |
| users | GET /api/v1/admin/users | can(people.manage) | people.manage scope filter (team/subteam) | **ORG(hard)** `user-account-router.ts:19,163` | search ≤200, role enum list, uuid teamId, dates | No page → returns every row (unbounded). Cross-tenant if more than one org (F-6). |
| users | POST /api/v1/admin/users | can(people.manage) | teamId must be in scope (GROUP/ORG only) | **ORG(hard)**; teamId not checked against the org when scope = ORG | name≥2, role enum, email, password **min 6, no max** | Creates person+account with an admin-chosen password, without access.users.manage, custody or audit; can set `role` = DIRECTOR (F-2, F-3). |
| users | PATCH /api/v1/admin/users/:id | can(people.manage) + `router.use('/:id')` scope check | people.manage scope | **ORG(hard)**; `teamId` written without scope/org validation (`:226`) | zod (no `.strict()`), `:id` not uuid-validated (500) | Changes `role` (authorization input, F-2), `email`/`active` of any account in scope including more privileged ones: credential-custody bypass, no audit for email (F-3). |
| users | GET /api/v1/admin/users/:id/employment-status | can(people.manage) + scope | — | ORG(hard) | — | OK within scope. |
| users | POST /api/v1/admin/users/:id/employment-status | can(people.manage) + scope | — | ORG(hard) | zod (status enum, dates, note ≤200) | OK within scope. |
| users | GET/PUT /api/v1/admin/users/:id/shift | can(people.manage) + scope | — | ORG(hard) | HH:mm, minutes 1..1440 | OK within scope. |
| profile-preferences | GET /api/v1/me/profile | RA | self | org+person from JWT | — | OK. |
| profile-preferences | PUT /api/v1/me/profile | RA | self | org+person from JWT; images bound to (org, person) | strict zod; multer memory 8 MB/file, 2 files, 8 fields; magic-byte sniffing JPEG/PNG/WebP; dimension limits | OK. SVG/GIF rejected; stored MIME comes from sniffing, not from the client. |
| profile-preferences | GET /api/v1/profile-images/:id | RA | any user in same org | `i.organization_id = session org` + image must be in use (`profile-preferences-service.ts:148-158`) | uuid (safeParse → 404) | OK. nosniff + CSP `default-src 'none'` + CORP same-site. Images of the same org are readable by any user (by design). |
| supervision-cases | GET /api/v1/supervision-cases | RA | **none** | **none — no org filter, no person filter** (`pg-case-repository.ts:28-31`) | — | All cases in the DB, unbounded (F-1). |
| supervision-cases | GET /api/v1/supervision-cases/:id | RA | **none** | **none** (`pg-case-repository.ts:33-41`); evidences/recommendations/feedbacks fetched by case_id only | `:id` not validated (500 on non-uuid) | Any user reads any case + evidence + feedback (F-1). |
| feedbacks | POST /api/v1/feedbacks/:id/publish | RA | **none** | **none** (`publish-feedback.ts:18`) | `:id` not validated | Any operator publishes any APPROVED feedback in any org (F-5). |
| diagnostics | GET /api/v1/diagnostics | RA + `authorize` (leads ≥1 active report OR indicators.view) | — | session org | free-text reason/indicator (parameterized) | Org-wide aggregates (`phrase_example`) for any leader, including other teams (info). |
| diagnostics | GET /diagnostics/performance | RA + authorize | — | session org + visible operators | — | OK. |
| diagnostics | GET /diagnostics/memory/{summary,filter-options,processes,people,concentration,materials,indicators,assessments} | RA + authorize | — | session org + `person_id = any(visible)` | page ≤200; **from/to any date (no range cap)** | Heavy aggregates over unbounded range (F-13). |
| diagnostics | GET /diagnostics/memory/indicators/:id, /assessments/:id | RA + authorize | — | `id + org + person_id = any(visible)` (`leadership-diagnostics.ts:428,470`) | uuid regex | OK. |
| diagnostics | GET /diagnostics/memory/export.csv | RA + authorize | — | same | `view` free text reflected in filename/preamble; 5000-row cap | CSV cells not formula-neutralized (F-16). |
| reporting | GET /api/v1/supervisor/overview | RA | **JWT `role` ∈ hierarchy** OR indicators.view (ORG) | **ORG(hard)**; whole operation | — | JWT role grants org-wide per-person data (F-2). Unbounded. |
| reporting | GET /api/v1/supervisor/operators/:id | RA | `canOpenEmployeeProfile` (subtree ∪ indicators.view scope) | scope check OK; data queries by operator id only | id checked against scope set | Returns feedbacks of every status (F-10). |
| reporting | GET /api/v1/operator/overview | RA | self | person from JWT; profile ORG(hard) | — | Returns the operator's own non-published feedbacks (F-10). |
| performance-analytics | GET /api/v1/analytics/context | RA | viewer scope (subtree ∪ indicators.view) | session org; `resolveSubject` | subjectKind enum, uuid | OK. |
| performance-analytics | GET /analytics/indicators | RA | same | `resolveSubject` | same + period clamp, comparison enum | OK. |
| performance-analytics | GET /analytics/indicators/breakdown | RA | same | `resolveSubject` | groupBy whitelist | OK. |
| performance-analytics | GET /analytics/indicators/:code/members | RA | same | `resolveSubject` | page ≤100, search ≤200 | OK. |
| performance-analytics | GET /analytics/team, /team/members | RA | same | `resolveSubject` | page ≤100, filters zod | OK. |
| performance-analytics | GET /analytics/follow-ups | RA | same | `resolveSubject`; feed SQL org-filtered | page ≤100 | OK. |
| org-structure | GET /api/v1/people/:personId/organization-structure | RA | open org chart (product decision); management metrics gated by **JWT role** OR structure.metrics.view | session org | uuid | Every user sees every active person's corporate email, group, job title (by design, info); management metrics (incl. leave buckets) granted by JWT role (F-2). |
| org-structure | GET /api/v1/admin/org-structure/teams | can(configuration.manage) | any scope | ORG(hard) | — | Scoped admin sees every team (info). |
| org-structure | GET /admin/org-structure/teams/manageable | can(configuration.manage) | scope-filtered | ORG(hard) | — | OK. |
| org-structure | POST /admin/org-structure/teams/:teamId/subteams | can(configuration.manage) | **any scope; teamId not checked against scope or org** | ORG(hard) | name≥2; `:teamId` not validated | F-8. |
| org-structure | GET/POST /admin/org-structure/subjects | can(configuration.manage) | any scope | ORG(hard) | name≥2 | Tenant-wide catalog writable by a scoped admin (F-8). |
| pending-actions | GET /api/v1/pending-actions | RA | recipient = viewer | `recipient_id = viewer AND organization_id` (`pending-actions-repository.ts:63`) | — | limit 200. OK. |
| pending-actions | GET /pending-actions/human-reviews/:enrollmentId/:nodeId | RA | recipient | same | uuid + nodeId min 1 | OK. |
| pending-actions | POST /pending-actions/human-reviews/:enrollmentId/:nodeId/decision | RA | recipient | same; optimistic lock on `revision` (`submit-human-review-decision.ts:40-49`) | decision enum; edge must exist | Idempotent/race-safe. OK. |
| pending-actions | GET /pending-actions/workday-reconciliations/:id | RA | recipient | `recipient_person_id + org` | uuid | OK. |
| pending-actions | POST /pending-actions/workday-reconciliations/:id/resolve | RA | recipient | same; `resolveReconciliation` with org | discriminated union | No lock (low); recipient stays authorized after a reorg (info). |
| people | GET /api/v1/team-calendar | RA | subtree ∪ calendar.manage scope; anchor must be visible | session org | dates, range ≤42 days, page ≤100 | OK. |
| people | POST /team-calendar/exceptions | RA | `assertCanManage` (operators below viewer OR active person in calendar.manage scope) | session org | uuid, code enum, ≤31 days | OK. |
| people | DELETE /team-calendar/exceptions/:exceptionId | RA | owner looked up in org → `assertCanManage` | session org | uuid | OK. |
| people | POST /team-calendar/classifications | RA | `assertCanManage` | session org | zod | OK. |
| people | GET /team-calendar/classifications/:personId/:date | RA | `assertCanManage` | session org | uuid, date | OK. |
| people | GET /team-calendar/exceptions/:exceptionId/audit | RA | **none beyond org** | `organization_id` only (`schedule-exception-service.ts:173-180`) | uuid | IDOR (F-11). |
| people | GET /api/v1/admin/operational-calendar/capitals | can(configuration.manage) | any scope | static | — | OK. |
| people | GET/PATCH /admin/operational-calendar/settings | can(configuration.manage) | **any scope** (tenant-wide setting) | ORG(hard) | enum, 1..90 | F-7. |
| people | GET /admin/operational-calendar/catalog, /catalog/coverage | can(configuration.manage) | any scope | global catalog | year/state/scope zod | OK. |
| people | GET/POST/PATCH/DELETE /admin/operational-calendar/holidays[/:id] | can(configuration.manage) | **any scope** | ORG(hard) | zod; `:id` not uuid-validated (500) | F-7. |
| notifications | GET /api/v1/notifications | RA | recipient | `recipient_id + org` (`notifications-repository.ts:38`) | — | limit 20. OK. |
| notifications | POST /notifications/read-all | RA | recipient | `recipient_id + org` | — | OK (POST, not GET). |
| notifications | POST /notifications/:id/read | RA | recipient | `id + recipient_id + org` (`:66`) | uuid | OK. |

## Cross-cutting observations

- Hardcoded organization ids in scope: `users/presentation/user-account-router.ts:19`, `reporting/presentation/supervisor-router.ts:9`, `reporting/application/fetch-operator-overview.ts:9`, `org-structure/presentation/org-structure-router.ts:6`, `people/presentation/operational-calendar-router.ts:19` (plus ~25 more outside scope: assistant, agents, knowledge, workflows, qa-lab, governance…).
- JWT `role` (snapshot of `people.role` at login, valid for `JWT_EXPIRES_IN` = 12 h) is used for authorization in `supervisor-router.ts:27` and `viewer-scope.ts:56,142-145` (→ `person-organization-structure.ts:287`). Every other use (`resolveDefaultSubject`, grouping options, labels) is presentation only.
- No SQL string interpolation of user input found: dynamic fragments are constants, numeric placeholders, or `SqlFilter` placeholders.
- `ZodError` → 400 with `issues`; `DomainError` → `details`; everything else → generic 500 (no stack traces). Non-uuid path ids on unvalidated routes cause Postgres 22P02 → generic 500.
- Defense-in-depth gaps (no exploit path found because ids are pre-scoped): `loadFollowUpCounts`, `loadPersistedIndicatorInsights`, `loadEmploymentStatus` (capital row), `fetchOperatorIndicators`, `pending-actions loadPeople/loadCase/loadGraph`, `loadCorporateEmails` query without `organization_id`.
