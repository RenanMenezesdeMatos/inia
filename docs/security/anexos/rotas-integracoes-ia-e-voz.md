> **Anexo técnico (em inglês, gerado na auditoria de 08/10/2026).** Descreve as rotas como estavam ANTES das correções — marcações como `scope✗`, `F-n` e "finding" apontam o problema encontrado, não o estado atual. A situação de cada achado está em [../relatorio-de-achados.md](../relatorio-de-achados.md) e as pendências em [../pendencias-e-riscos.md](../pendencias-e-riscos.md).

# INIA backend — integrations / AI surfaces audit matrix (2026-10-08)

Scope: data-hub, ingestion (legacy), realtime, conversational-delivery, feedback-application, feedback-rating,
interaction-feedback/presentation, usage-analytics. Paths relative to `backend/`.

Legend — auth: `RA` = requireAuth (JWT cookie + DB session); `can(p)` = requirePermission(p) = RA + p in ANY scope
(src/modules/access/presentation/require-permission.ts:27); `can(p, org)` = organizationWide. "org" in object-check = filters by
`request.user.organizationId`. "scope" = filters by Group/Subgroup/MyStructure of the grant.

Global middleware (src/main/app.ts): helmet, CORS(origin=CORS_ORIGIN, credentials) :98, `express.json({limit:"1mb"})` :99 runs
BEFORE every router (so the push router's own 10 MB parser never sees > 1 MB), cookieParser :100, error handler maps only
DomainError/ZodError; anything else (MulterError, PayloadTooLarge, SyntaxError) = 500 :196-207.

## 1. Central de Dados — `/api/v1/admin/data-hub` (app.ts:155, `can("data_hub.manage")`, NOT org-wide)

`data_hub.manage` is in role ADMINISTRADOR, assignable at GROUP/SUBGROUP scope (access/domain/roles.ts:30-31). No route in the
module reads `request.access` or applies scope — every route is org-wide once the guard passes.

| surface (data-hub-router.ts line) | auth | object check | validation | external calls | notes |
|---|---|---|---|---|---|
| POST /database/test (72) | can(data_hub.manage) | org only when `sourceId` w/o password (source-service.ts:172); with password, `sourceId` unchecked (used as slot key + audit entity) | databaseDraftTestSchema (source-service.ts:159): host regex only, any port 1-65535, any engine | opens pg/mssql/mysql2 connection to ANY host:port (incl. 127.0.0.1, 169.254.169.254) | stored password of source X can be sent to a NEW host (source-service.ts:170-178) — credential relay; driver error text echoed (sanitized of password) → port-scan oracle; no rate limit; slot key varies by host → unbounded parallelism |
| GET /sources/:id/database/objects (76) | same | requireSource org (records.ts:131) | search ≤128 | external DB catalog SELECT | |
| GET /sources/:id/database/columns (82) | same | org | schema/name ≤128 | external DB catalog | any schema incl. pg_catalog accepted (listing excludes it, describe doesn't) |
| GET /overview, /quality, /contracts, /contracts/:key, /lineage (89-117) | same | org | zod | none | lineage filtered by org (overview-service.ts:434) |
| GET /sources (120), GET /sources/:id (128) | same | org | — | none | returns `config` incl. free-form `api.headers` (records.ts:98, source-config.ts:19,32) — secrets put in custom headers are returned in clear; secret VALUES never returned (only purposes/dates, aes-secret-store.ts:85-91) |
| POST /sources (124) | same | org from session | sourceInputSchema: `baseUrl`/`tokenUrl` `z.string().url()`, SFTP host free string, DB host regex | none | no allow/deny-list for hosts |
| PATCH /sources/:id (136) | same | org | partial schema | none | config (host/baseUrl/tokenUrl/username) can change while stored secrets are KEPT (storeSecrets requireAll=false, source-service.ts:96) → secret re-pointing |
| DELETE /sources/:id (140) | same | org | — | — | soft delete + revokes push tokens |
| POST /sources/:id/test-connection (145) | same | org | — | HTTP GET baseUrl with auth headers / SFTP list / DB | returns `HTTP <status> em <baseUrl>` (api-pull-connector.ts:88) → SSRF status oracle |
| POST /sources/:id/status, /secrets (149,154) | same | org | zod | — | secrets AES-256-GCM, random 12-byte IV, tag stored; key from env DATA_HUB_SECRET_KEY (prod mandatory) |
| GET/POST /sources/:id/tokens, /revoke, /rotate (158-178) | same | org + source | label 2-80, feedId uuid (not checked to belong to source) | — | token = `inia_push_` + 24 random bytes, SHA-256 at rest, shown once; no expiry |
| POST /sources/:id/sample (181) | same | source org; **rawObjectId NOT org-checked** (feed-service.ts:154 → pg-raw-object-store.ts:30 `where id = $1`) | connectorConfig from BODY | API_PULL: fetch to `endpoint` — absolute URL allowed (api-pull-connector.ts:56) WITH the source's auth headers; SFTP; DB | full-read SSRF for JSON-array responses; credential exfil |
| POST /sources/:id/preview (187) | same | org | sample records from body (≤1 MB) | none | writer.prepare reads org data |
| POST /sources/:id/sftp-files (193) | same | org | any remoteDirectory | SFTP list | |
| POST /uploads (200) | same | sourceId org-checked if sent | multer memoryStorage, fileSize 50 MB only (no fields/parts/fieldSize caps), format by extension | none | XLSX via exceljs load-all (zip-bomb surface); raw kept 30 d in bytea, no quota |
| GET/POST /sources/:id/feeds, GET/PATCH/DELETE /feeds/:id, /status, /sync, /checkpoint/reset (231-270) | same | org | feedInputSchema; DB feed validated live | sync enqueues run | API_PULL feed `endpoint` may be absolute URL; maxPages ≤10 000, timeout ≤120 s |
| POST /feeds/:id/sample, /preview (272-284) | same | org; rawObjectId unchecked (same as above) | | | |
| POST /feeds/:id/import (287) | same | feed org; **raw object fetched by id only** (data-hub-router.ts:292) | rawObjectId uuid | enqueues run on that raw object | cross-tenant raw import if UUID known (latent: installs are single-org) |
| GET /runs, /runs/:id, /runs/:id/rejections (306-346) | same | org | SqlFilter parameterized | | |
| GET /runs/:id/rejections.csv (349) | same | org | — | — | **no formula neutralization**: `source_record_key`/`message` from client data (data-hub-router.ts:355-356) |
| POST /runs/:id/reprocess, /cancel (362-370) | same | org | | | |
| Job: runDataHubTick / processQueuedRuns / kickWorker (run-service.ts:88-236) | n/a | runs carry org | | API/SFTP/DB pulls | serial worker; one slow feed (10 000 pages × 120 s) blocks queue; lease 15 min |
| Writers (master-data-writers.ts:189-240) | via run | org | contract validation | — | EMPLOYEES feed rewrites `people.role/team/subteam/active`, `reports_to_id`, and **`user_accounts.email` (= login id)** for any person in the org |

### Connectors (infrastructure)
| connector | TLS / host verification | limits | notes |
|---|---|---|---|
| HTTP (fetch-http-client.ts) | system CA; `redirect: "manual"` (:10) | timeout only; **body unbounded** (`response.text()` :17) | no host allowlist, no private-IP block, no DNS pinning |
| SFTP (ssh2-sftp-client.ts) | `hostVerifier` returns **true when no fingerprint configured** (:24); fingerprint optional in schema (source-config.ts:44); observed key never recorded despite comment | readyTimeout; **download fully buffered, no size cap** (:88-92) | |
| PostgreSQL (postgres-session.ts) | PREFERRED (default) = `rejectUnauthorized:false` then plaintext fallback (:57-64); REQUIRED = no verify | `default_transaction_read_only`, statement_timeout, lock_timeout, one client/op | pg sends cleartext password if server asks (node_modules/pg/lib/client.js:251,313) |
| MySQL/MariaDB (mysql-session.ts) | PREFERRED/REQUIRED `rejectUnauthorized:false`; VERIFY_FULL ok | READ ONLY tx, max_execution_time, `multipleStatements:false` | mysql2 3.24.5 refuses LOCAL INFILE w/o factory and cleartext plugin by default |
| SQL Server (sqlserver-session.ts) | `trustServerCertificate: tlsMode !== "VERIFY_FULL"` (:25) — default REQUIRED trusts any cert | requestTimeout, pool max 1, `readOnlyIntent` only (no server-enforced read-only) | |
| SQL dialect (sql-dialect.ts) | — | integer-validated LIMIT/TOP; identifiers quoted with delimiter doubling (:113,188,260); values bound | no user SQL; castType from remote catalog only |

## 2. Inbound API Push — `/api/v1/data-ingestion` (app.ts:159, NO requireAuth)
| surface | auth | object check | validation | notes |
|---|---|---|---|---|
| POST /:sourcePublicId/:feedKey (data-ingestion-router.ts:22) | Bearer push token: SHA-256 lookup (push-ingestion.ts:40); bound to source (+ optional feed) and public_id; source/feed ACTIVE | token→source→feed chain | params regex; body non-empty; effective size limit 1 MB (global parser) not 10 MB | rate-limit Map keyed by **raw unauthenticated token string**, never evicted (push-ingestion.ts:18-31, router :27) → memory DoS; Idempotency-Key optional (dedupe by feed+key) |

## 3. Legacy ingestion — `/api/v1/ingestion` (app.ts:161, `can("data_hub.manage")`)
| surface | auth | object check | validation | notes |
|---|---|---|---|---|
| POST /indicator-measurements/batch (ingestion-router.ts:24) | can(data_hub.manage) | **organizationId hard-coded** `00000000-…-0001` (:9); `people p where p.id=$3` without org (:34) | ≤1000 items | bypasses Data Hub lineage/audit; triggers indicator workflow enrollment |
| POST /interactions (:60) | same | hard-coded org; operatorId unchecked vs org | transcript min 10, **no max** | inserts transcript + flags → enrolls flag workflows (LLM cost, auto-published feedback) |

## 4. Realtime / voice — `/api/v1/realtime` (app.ts:162, RA)
| surface (realtime-router.ts) | object check | validation | external calls | notes |
|---|---|---|---|---|
| POST /sessions (147) | feedbackApplicationId owned (feedback-application-service.ts:603-605) | uuid | Gemini `auth_tokens` (gemini-realtime-client.ts:44) | token: expire 30 min, new-session 5 min, **no `bidiGenerateContentSetup`/liveConnectConstraints** (:50) → client picks model/prompt/tools; no per-user rate limit; usage not metered (llm-gateway.ts:221 usage:null); returns orchestrator `systemPrompt` to browser |
| POST /tool-call (195) | specialist must belong to caller's orchestrator (:199); conversation owned | `query` no max, `periodDays` unbounded | specialist LLM + tools as self | no rate limit |
| GET /conversations/current, /conversations, POST /conversations/new, GET /conversations/:id/messages (255-291) | owner scope (assistant-conversations.ts:110-134) | zod | — | |
| POST /voice-turn (297) | owned conversation | userText/assistantText **no max** | — | client can persist arbitrary "assistant" turns (forged INIA speech) visible to managers/monitoring and reused as model context |
| POST /messages (310) | owned conversation; history read from DB | text ≤8000; **`systemInstruction` client-supplied, no max** (:39) | Gemini stream / orchestrator | client text appended to orchestrator system prompt as extraContext (run-orchestrated-reply.ts:191) or IS the whole system prompt without orchestrator (:427,439) |

## 5. Conversational delivery — `/api/v1/inia-deliveries` (app.ts:170, RA)
| surface | object check | notes |
|---|---|---|
| GET /inbox | recipient = session (avatar-delivery-service.ts:75,85) | |
| POST /avatar/:id/events | `id+org+recipient` for update (:137) | alerts updated by dedupe key derived from owned output |
| GET /avatar/:id/audio | owned (recado-speech-audio.ts:20); cached TTS; budget check in gateway | |
| POST /conversations/:id/seen | owner+org (:168) | |

## 6. Feedback application / confirmation / rating / interaction-feedback
| surface | auth | object check | notes |
|---|---|---|---|
| /api/v1/feedback-applications GET /, /invite, POST /invite/events, POST /, GET /:id, POST /:id/opened, /presentation-events, /pause, GET /:id/audio | RA | recipient = session; `findOwned` (feedback-application-service.ts:315-321), `loadAuthorizedSource`; 404 otherwise | TTS cached per application + in-flight dedupe |
| /api/v1/feedback-read-confirmations POST /events, POST / | RA (pending-password sessions blocked) | owned source (read-confirmation-service.ts:55-73); password checked vs session account, login must equal own email | own throttle 5 fails/15 min per account, **not atomic** (read → verify → insert, :164-181) and independent of login throttle |
| /api/v1/feedback-ratings GET /, POST / | RA | owned + published + visible (feedback-rating-service.ts:38-47); advisory lock | comment 3-1000 chars; history rows unbounded |
| /api/v1/feedback-quality-reviews (flag OFF default) | RA + grants in service | SCOPE_CTE + `collaborator_id <> viewer` (postgres-feedback-review-reader.ts:54) | |
| /api/v1/feedback-deliveries GET /mine (flag OFF default) | RA | viewer only | |

## 7. Usage analytics
| surface | auth | object check | validation | notes |
|---|---|---|---|---|
| POST /api/v1/usage/events/batch (usage-events-router.ts:17) (only if INIA_USAGE_COLLECTION=ON) | RA | org/account/person from session; batch.accountId must equal session (ingest-client-events.ts:29); entities authorized (entity-authorization.ts) | ≤100 events, ≤128 KB, 600 ev/min/account in-memory, strict catalog | text/plain beacon accepts missing Origin (:23) — relies on SameSite=lax; NOT_FOUND vs NOT_AUTHORIZED counts = UUID existence oracle |
| /api/v1/admin/usability/* (usability-router.ts) (only if INIA_USABILITY_PANEL=ON) | can(usability.view) + per-route permission | person detail uses `usability.users.view` scope (person-query.ts:28); **lists/exports identify people over the `usability.view` scope** (usability-context.ts:40,92; people-query.ts:200) | filters zod, ORDER BY from map, SqlParams | CSV export neutralizes `= + - @ TAB CR` (usability-csv.ts:8-18) + audit log |
| server-fact taps (server-fact-taps.ts) | — | reads response `data` only | — | never reads passwords |
