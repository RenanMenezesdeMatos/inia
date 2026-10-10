import { randomUUID } from "node:crypto"
import type pg from "pg"

/**
 * MASSA DETERMINÍSTICA da Monitoria de usabilidade — organização PRÓPRIA (nada de outra prova entra nos totais), fuso
 * America/Fortaleza (UTC−3), dois dias completos: D1 = 05/10/2026 e D2 = 06/10/2026 (locais), "agora" = 07/10/2026 12:00 local.
 * O resultado esperado está nas asserções de usability-proof.test.ts e em docs/dev/monitoria-usabilidade.md (seção Massa de teste).
 *
 * Pessoas: Ana (operadora, ativa nos dois dias, desktop com 2 abas e celular), Bruno (elegível sem atividade, outro Grupo),
 * Carla (sem conta), Diego (conta desabilitada, férias), Fábio (DEMONSTRAÇÃO, com atividade), Gabi (conta criada depois do
 * início da coleta, nunca acessou), Hugo (desligado), Vera (Administradora geral — solicita uma execução manual), Lia (leitora
 * de agregados), Alan (analista com escopo no Grupo de Bruno). Outra organização (Xavier) prova isolamento.
 */
export const FIXTURE_TZ = "America/Fortaleza"
export const FIXTURE_NOW = new Date("2026-10-07T15:00:00Z")
export const COLLECTION_START = new Date("2026-10-04T15:00:00Z")

export type FixtureIds = {
  org: string
  otherOrg: string
  operation: string
  teamA: string
  teamB: string
  subteamA: string
  people: Record<"ana" | "bruno" | "carla" | "diego" | "fabio" | "gabi" | "hugo" | "vera" | "lia" | "alan" | "xavier", string>
  accounts: Record<"ana" | "bruno" | "diego" | "fabio" | "gabi" | "hugo" | "vera" | "lia" | "alan" | "xavier", string>
  assignments: Record<"vera" | "lia" | "alan", string>
  cases: string[]
  feedbacks: Record<"f1" | "f2" | "f3" | "f4", string>
  alert: string
  conversations: Record<"c1" | "c2" | "c3", string>
  application: string
  workflows: Record<"w1" | "w2" | "w3", string>
  versions: Record<"w1" | "w2" | "w3", string>
  manualRun: string
  roots: Record<"r1" | "r2" | "r3", string>
  children: string[]
}

const at = (iso: string) => new Date(iso)

export async function seedFixtureBase(pool: pg.Pool): Promise<FixtureIds> {
  const tag = randomUUID().slice(0, 8)
  const one = async <T = { id: string }>(sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0] as T
  const org = (await one(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Prova Usabilidade ${tag}`, `prova-usabilidade-${tag}`])).id
  const otherOrg = (await one(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Prova Usabilidade Outra ${tag}`, `prova-usabilidade-outra-${tag}`])).id
  const operation = (await one(`insert into operations (organization_id, name, timezone) values ($1, 'Operação prova', $2) returning id`, [org, FIXTURE_TZ])).id
  const otherOperation = (await one(`insert into operations (organization_id, name, timezone) values ($1, 'Operação prova', $2) returning id`, [otherOrg, FIXTURE_TZ])).id
  const teamA = (await one(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Grupo A') returning id`, [org, operation])).id
  const teamB = (await one(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Grupo B') returning id`, [org, operation])).id
  const otherTeam = (await one(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Grupo X') returning id`, [otherOrg, otherOperation])).id
  const subteamA = (await one(`insert into subteams (organization_id, team_id, name) values ($1, $2, 'Subgrupo A1') returning id`, [org, teamA])).id

  const person = async (name: string, role: string, teamId: string, options: { active?: boolean; status?: string; organizationId?: string; subteamId?: string | null; reportsTo?: string | null } = {}) =>
    (await one(`insert into people (organization_id, name, role, team_id, subteam_id, active, current_employment_status, reports_to_id, job_title, matricula) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [options.organizationId ?? org, name, role, teamId, options.subteamId ?? null, options.active ?? true, options.status ?? "EM_PRODUCAO", options.reportsTo ?? null, role === "OPERATOR" ? "Operador(a)" : "Gestão", `PRV-${tag}-${name.split(" ")[0]}`])).id
  const vera = await person("Vera Gestora", "MANAGER", teamA)
  const people = {
    vera,
    ana: await person("Ana Prova", "OPERATOR", teamA, { subteamId: subteamA, reportsTo: vera }),
    bruno: await person("Bruno Prova", "OPERATOR", teamB, { reportsTo: vera }),
    carla: await person("Carla Prova", "OPERATOR", teamA, { reportsTo: vera }),
    diego: await person("Diego Prova", "OPERATOR", teamA, { status: "FERIAS", reportsTo: vera }),
    fabio: await person("Fábio Demonstração", "OPERATOR", teamA, { reportsTo: vera }),
    gabi: await person("Gabi Prova", "OPERATOR", teamA, { reportsTo: vera }),
    hugo: await person("Hugo Prova", "OPERATOR", teamA, { active: false, reportsTo: vera }),
    lia: await person("Lia Leitora", "MANAGER", teamA),
    alan: await person("Alan Analista", "MANAGER", teamB),
    xavier: await person("Xavier Outra Org", "OPERATOR", otherTeam, { organizationId: otherOrg }),
  }
  const account = async (key: keyof FixtureIds["accounts"], options: { active?: boolean; createdAt?: Date } = {}) =>
    (await one(`insert into user_accounts (organization_id, person_id, email, password_hash, active, created_at) values ($1,$2,$3,'x',$4,$5) returning id`, [key === "xavier" ? otherOrg : org, people[key], `${key}.${tag}@prova-usabilidade.local`, options.active ?? true, options.createdAt ?? at("2026-09-01T12:00:00Z")])).id
  const accounts = {
    ana: await account("ana"),
    bruno: await account("bruno"),
    diego: await account("diego", { active: false }),
    fabio: await account("fabio"),
    gabi: await account("gabi", { createdAt: at("2026-10-05T13:00:00Z") }),
    hugo: await account("hugo"),
    vera: await account("vera"),
    lia: await account("lia"),
    alan: await account("alan"),
    xavier: await account("xavier"),
  }
  const assign = async (accountKey: "vera" | "lia" | "alan", role: string, scope: "ORGANIZATION" | "GROUP", teamId: string | null = null) =>
    (await one(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, source, granted_at) values ($1,$2,$3,$4,$5,'MANUAL',$6) returning id`, [org, accounts[accountKey], role, scope, teamId, at("2026-09-01T12:00:00Z")])).id
  const assignments = { vera: await assign("vera", "ADMINISTRADOR_GERAL", "ORGANIZATION"), lia: await assign("lia", "LEITOR_DE_USABILIDADE", "ORGANIZATION"), alan: await assign("alan", "ANALISTA_DE_USABILIDADE", "GROUP", teamB) }
  await pool.query(`insert into usage_population_classifications (organization_id, person_id, classification, reason) values ($1, $2, 'DEMO', 'Conta de demonstração da prova')`, [org, people.fabio])

  const cases: string[] = []
  const feedback = async (operatorId: string, kind: "MONITORING" | "INDICATOR", publishedAt: Date) => {
    const caseId = (await one(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,$3,'Prova','Resumo','P3','TMA','400','380') returning id`, [org, operatorId, teamA])).id
    cases.push(caseId)
    return (await one(`insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at) values ($1,$2,$3,'PUBLISHED',$4,'—','—','—','—','Texto.',$5) returning id`, [org, caseId, operatorId, kind, publishedAt])).id
  }
  const feedbacks = {
    f1: await feedback(people.ana, "MONITORING", at("2026-10-05T11:00:00Z")),
    f2: await feedback(people.ana, "INDICATOR", at("2026-10-06T11:00:00Z")),
    f3: await feedback(people.bruno, "MONITORING", at("2026-10-05T11:00:00Z")),
    f4: await feedback(people.ana, "MONITORING", at("2026-10-05T13:05:00Z")),
  }
  const alert = (await one(`insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at) values ($1,$2,'Novo feedback','—','INFO','FEEDBACK_PUBLISHED',$3,$4) returning id`, [org, people.ana, `prova:${tag}`, at("2026-10-05T11:30:00Z")])).id

  const conversation = async (owner: string, origin: string, createdAt: Date) => (await one(`insert into assistant_conversations (organization_id, owner_person_id, kind, status, origin, started_at, last_activity_at, created_at) values ($1,$2,'CONVERSATION','ACTIVE',$3,$4,$4,$4) returning id`, [org, owner, origin, createdAt])).id
  const conversations = { c1: await conversation(people.ana, "USER", at("2026-10-05T12:20:00Z")), c2: await conversation(people.ana, "FEEDBACK", at("2026-10-06T17:01:00Z")), c3: await conversation(people.bruno, "WORKFLOW", at("2026-10-05T10:00:00Z")) }
  const message = async (conversationId: string, owner: string, role: string, channel: string, occurredAt: Date, clientMessageId: string | null = null) =>
    pool.query(`insert into assistant_interactions (organization_id, operator_id, channel, role, content, conversation_id, occurred_at, created_at, client_message_id) values ($1,$2,$3,$4,'(conteúdo da prova)',$5,$6,$6,$7)`, [org, owner, channel, role, conversationId, occurredAt, clientMessageId])
  await message(conversations.c1, people.ana, "user", "chat", at("2026-10-05T12:20:01Z"))
  await message(conversations.c1, people.ana, "assistant", "chat", at("2026-10-05T12:20:03Z"))
  await message(conversations.c1, people.ana, "user", "voice", at("2026-10-05T12:25:00Z"))
  await message(conversations.c1, people.ana, "assistant", "voice", at("2026-10-05T12:25:04Z"))
  await message(conversations.c2, people.ana, "user", "voice", at("2026-10-06T17:01:30Z"))
  await message(conversations.c2, people.ana, "assistant", "voice", at("2026-10-06T17:01:40Z"))
  await message(conversations.c3, people.bruno, "assistant", "chat", at("2026-10-05T10:00:00Z"), `workflow-output:${tag}`)
  const application = (await one(`insert into feedback_applications (organization_id, recipient_person_id, source_kind, feedback_id, status, conversation_id, context, context_version, presentation, presentation_version, started_at, created_at, updated_at) values ($1,$2,'PUBLISHED_FEEDBACK',$3,'IN_PROGRESS',$4,'{}'::jsonb,'PROVA','{}'::jsonb,'PROVA',$5,$5,$5) returning id`, [org, people.ana, feedbacks.f2, conversations.c2, at("2026-10-06T17:01:00Z")])).id

  // Avaliação de F1: UP → DOWN → NONE (histórico; uma vigente).
  await pool.query(`insert into feedback_ratings (organization_id, person_id, source_kind, feedback_id, value, created_at, superseded_at) values ($1,$2,'PUBLISHED_FEEDBACK',$3,'UP',$4,$5)`, [org, people.ana, feedbacks.f1, at("2026-10-05T12:01:31Z"), at("2026-10-05T12:03:00Z")])
  await pool.query(`insert into feedback_ratings (organization_id, person_id, source_kind, feedback_id, value, reason, comment, created_at, superseded_at) values ($1,$2,'PUBLISHED_FEEDBACK',$3,'DOWN','UNCLEAR','Não entendi o prazo.',$4,$5)`, [org, people.ana, feedbacks.f1, at("2026-10-05T12:03:00Z"), at("2026-10-06T17:05:00Z")])
  await pool.query(`insert into feedback_ratings (organization_id, person_id, source_kind, feedback_id, value, created_at) values ($1,$2,'PUBLISHED_FEEDBACK',$3,'NONE',$4)`, [org, people.ana, feedbacks.f1, at("2026-10-06T17:05:00Z")])
  // Ciência de F1: tentativa com falha recuperada + confirmação repetida em outra aba (idempotente).
  const attempt1 = randomUUID()
  const attempt2 = randomUUID()
  const confirmation = (attemptId: string, event: string, occurredAt: Date, extra: { failure?: string; already?: boolean } = {}) =>
    pool.query(`insert into feedback_read_confirmation_events (organization_id, person_id, account_id, source_kind, feedback_id, entry_point, attempt_id, event, failure_reason, already_confirmed, completed_application, device, occurred_at) values ($1,$2,$3,'PUBLISHED_FEEDBACK',$4,'FOLLOW_UP_FEED',$5,$6,$7,$8,$9,'DESKTOP',$10)`, [org, people.ana, accounts.ana, feedbacks.f1, attemptId, event, extra.failure ?? null, event === "CONFIRMED" ? (extra.already ?? false) : null, event === "CONFIRMED" ? false : null, occurredAt])
  await confirmation(attempt1, "OPENED", at("2026-10-05T12:04:00Z"))
  await confirmation(attempt1, "FAILED", at("2026-10-05T12:04:30Z"), { failure: "WRONG_PASSWORD" })
  await confirmation(attempt1, "CONFIRMED", at("2026-10-05T12:05:00Z"))
  await confirmation(attempt2, "OPENED", at("2026-10-05T12:10:00Z"))
  await confirmation(attempt2, "CONFIRMED", at("2026-10-05T12:10:20Z"), { already: true })
  await pool.query(`update feedbacks set acknowledged_at = $2 where id = $1`, [feedbacks.f1, at("2026-10-05T12:05:00Z")])
  await pool.query(`update alerts set read_at = $2 where id = $1`, [alert, at("2026-10-05T12:01:02Z")])

  // Workflows: W1 manual (raiz com 10 filhos + raiz agendada morta), W2 aguardando revisão humana, W3 publicado sem execução.
  const workflow = async (name: string, trigger: string) => {
    const id = (await one(`insert into workflows (organization_id, name, trigger_config, draft_graph, active) values ($1,$2,$3,'{"nodes":[],"edges":[]}',true) returning id`, [org, name, trigger])).id
    const version = (await one(`insert into workflow_versions (workflow_id, graph) values ($1, '{"nodes":[],"edges":[]}') returning id`, [id])).id
    await pool.query(`update workflows set active_version_id = $2 where id = $1`, [id, version])
    return { id, version }
  }
  const w1 = await workflow("Prova · Monitoria manual", '{"kind":"manual","context":"COLLABORATOR"}')
  const w2 = await workflow("Prova · Revisão humana", '{"kind":"schedule"}')
  const w3 = await workflow("Prova · Sem execução", '{"kind":"schedule"}')
  const manualRun = (await one(`insert into workflow_manual_runs (organization_id, workflow_id, version_id, requested_by, requested_at, idempotency_key, context, collaborator_id) values ($1,$2,$3,$4,$5,$6,'COLLABORATOR',$7) returning id`, [org, w1.id, w1.version, people.vera, at("2026-10-05T13:00:00Z"), `prova-${tag}`, people.ana])).id
  const enrollment = async (workflowId: string, versionId: string, status: string, subject: string, createdAt: Date, updatedAt: Date, extra: { manualRunId?: string; parent?: string; fanOutNode?: string } = {}) =>
    (await one(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, scheduled_subject_id, scheduled_for, manual_run_id, parent_enrollment_id, fan_out_node_id, created_at, updated_at) values ($1,$2,$3,'end',$4,$5,$6,$7,$8,$9,$10,$11) returning id`, [org, workflowId, versionId, status, subject, extra.parent || extra.manualRunId ? null : createdAt, extra.manualRunId ?? null, extra.parent ?? null, extra.parent ? (extra.fanOutNode ?? "fan") : null, createdAt, updatedAt])).id
  const r1 = await enrollment(w1.id, w1.version, "completed", people.ana, at("2026-10-05T13:00:01Z"), at("2026-10-05T13:05:00Z"), { manualRunId: manualRun })
  const children: string[] = []
  // Fan-out: um filho por (nó, pessoa) — 5 nós × Ana/Bruno.
  for (let index = 0; index < 10; index += 1) children.push(await enrollment(w1.id, w1.version, "completed", index % 2 === 0 ? people.ana : people.bruno, at("2026-10-05T13:00:02Z"), at("2026-10-05T13:04:00Z"), { parent: r1, fanOutNode: `fan-${Math.floor(index / 2)}` }))
  // Retries de um filho: dois node_failed com nova tentativa — continua sendo UM disparo raiz.
  for (const attempt of [1, 2]) await pool.query(`insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key, created_at) values ($1,'agent','node_failed',$2,$3,$4)`, [children[0], JSON.stringify({ errorCode: "TRANSIENT_PROVIDER_ERROR", willRetry: true, attempt }), `retry:${attempt}`, at("2026-10-05T13:02:00Z")])
  const r2 = await enrollment(w1.id, w1.version, "dead", people.bruno, at("2026-10-06T12:00:00Z"), at("2026-10-06T12:10:00Z"))
  await pool.query(`insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key, created_at) values ($1,'agent','flow_dead',$2,'dead:1',$3)`, [r2, JSON.stringify({ errorCode: "AGENT_STRUCTURED_OUTPUT_INVALID" }), at("2026-10-06T12:10:00Z")])
  const r3 = await enrollment(w2.id, w2.version, "waiting", people.ana, at("2026-10-06T12:00:00Z"), at("2026-10-06T12:00:05Z"))
  await pool.query(`insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key, created_at) values ($1,'review','human_review_requested','{}','review:1',$2)`, [r3, at("2026-10-06T12:00:05Z")])
  await pool.query(`insert into workflow_output_emissions (organization_id, enrollment_id, node_id, surface, recipient_id, case_id, feedback_id, created_at) values ($1,$2,'out','FOLLOW_UP',$3,$4,$5,$6)`, [org, r1, people.ana, cases[3], feedbacks.f4, at("2026-10-05T13:05:00Z")])
  for (const enrollmentId of [r1, children[1]]) {
    await pool.query(
      `insert into ai_usage_events (organization_id, occurred_at, use_case, origin, provider_key, model_name, correlation_id, total_tokens, cost, currency, cost_status, pricing_source, status, routing_mode, route_reason, workflow_id, enrollment_id, root_enrollment_id)
       values ($1,$2,'AGENT_RESPONSE','RUNTIME','GEMINI','prova',gen_random_uuid(),1000,0.010000,'USD','ESTIMATED','TABLE','SUCCESS','LEGACY','prova',$3,$4,$5)`,
      [org, at("2026-10-05T13:01:00Z"), w1.id, enrollmentId, r1],
    )
  }
  return {
    org, otherOrg, operation, teamA, teamB, subteamA, people, accounts, assignments, cases, feedbacks, alert, conversations, application,
    workflows: { w1: w1.id, w2: w2.id, w3: w3.id }, versions: { w1: w1.version, w2: w2.version, w3: w3.version }, manualRun, roots: { r1, r2, r3 }, children,
  }
}

/** Restos de uma execução interrompida: organizações da prova (slug próprio) — limpa antes de semear de novo. */
export async function cleanupLeftovers(pool: pg.Pool) {
  const orgs = (await pool.query<{ id: string }>(`select id from organizations where slug like 'prova-usabilidade-%'`)).rows.map((row) => row.id)
  if (orgs.length > 0) await cleanupOrganizations(pool, orgs)
}

/** Remove TUDO o que a massa criou (pelas duas organizações da prova) — nunca toca outra organização. */
export async function cleanupFixture(pool: pg.Pool, ids: FixtureIds) {
  await cleanupOrganizations(pool, [ids.org, ids.otherOrg])
}

async function cleanupOrganizations(pool: pg.Pool, orgs: string[]) {
  const run = (sql: string) => pool.query(sql, [orgs])
  for (const table of ["usage_events", "usage_ingest_batches", "usage_coverage", "usage_sessions", "usage_person_days", "usage_screen_person_days", "usage_projection_dirty", "usage_eligibility_periods", "usage_eligibility_tracking", "usage_person_milestones", "usage_population_classifications", "usage_settings", "usage_collection_toggles"]) await run(`delete from ${table} where organization_id = any($1)`)
  await run(`delete from ai_usage_events where organization_id = any($1)`)
  await run(`delete from workflow_output_emissions where organization_id = any($1)`)
  await run(`delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where organization_id = any($1))`)
  await run(`delete from workflow_enrollments where organization_id = any($1) and parent_enrollment_id is not null`)
  await run(`delete from workflow_enrollments where organization_id = any($1)`)
  await run(`delete from workflow_manual_runs where organization_id = any($1)`)
  await run(`update workflows set active_version_id = null where organization_id = any($1)`)
  await run(`delete from workflow_versions where workflow_id in (select id from workflows where organization_id = any($1))`)
  await run(`delete from workflows where organization_id = any($1)`)
  await run(`delete from feedback_read_confirmation_events where organization_id = any($1)`)
  await run(`delete from feedback_ratings where organization_id = any($1)`)
  await run(`delete from feedback_applications where organization_id = any($1)`)
  await run(`delete from assistant_interactions where organization_id = any($1)`)
  await run(`delete from assistant_conversations where organization_id = any($1)`)
  await run(`delete from alerts where organization_id = any($1)`)
  await run(`delete from feedbacks where organization_id = any($1)`)
  await run(`delete from supervision_cases where organization_id = any($1)`)
  await run(`delete from audit_logs where organization_id = any($1)`)
  await run(`delete from access_role_assignments where organization_id = any($1)`)
  await run(`delete from user_accounts where organization_id = any($1)`)
  await run(`update people set reports_to_id = null where organization_id = any($1)`)
  await run(`delete from people where organization_id = any($1)`)
  await run(`delete from subteams where organization_id = any($1)`)
  await run(`delete from teams where organization_id = any($1)`)
  await run(`delete from operations where organization_id = any($1)`)
  await run(`delete from organizations where id = any($1)`)
}
