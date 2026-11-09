/**
 * PROVA contra o banco de teste real: a consulta de dados da Central, de ponta a ponta pelas rotas, com o guard, os limites e o PostgreSQL de verdade.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run data-explorer-proof --no-file-parallelism
 * Duas organizações próprias, apagadas no fim. Nenhuma chamada de IA nem rede externa.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp, type CreateAppOptions } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { withExplorerSession } from "../application/read-only-session.js"
import { EXPLORER_DATASETS, findExplorerDataset } from "../domain/explorer-catalog.js"
import { compilePageQuery } from "../domain/explorer-compiler.js"
import { explorerLimitsFrom } from "../domain/explorer-limits.js"
import { parseExplorerRequest, resolveExplorerQuery } from "../domain/explorer-query.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const API = "/api/v1/admin/data-explorer"
const PASSWORD = "Prova@Consulta-2026"
const ORG_A = "de00ee00-0000-4000-8000-0000000e0173"
const ORG_B = "de00ee00-0000-4000-8000-0000000f0173"
const SECRET_VALUE = "VALOR-PESSOAL-DO-FILTRO-777"

const limits = explorerLimitsFrom({ DATA_EXPLORER_DEFAULT_PAGE_SIZE: 25, DATA_EXPLORER_MAX_PAGE_SIZE: 100, DATA_EXPLORER_QUERY_TIMEOUT_MS: 5_000, DATA_EXPLORER_CANCEL_MAX_ROWS: 10_000, DATA_EXPLORER_COUNT_CAP: 10_000, DATA_EXPLORER_EXPORT_MAX_ROWS: 20_000, DATA_EXPLORER_EXPORT_MAX_BYTES: 20_971_520, DATA_EXPLORER_EXPORT_MAX_DURATION_MS: 60_000 })

let pool: pg.Pool
const ids: Record<string, string> = {}
const accountIds: Record<string, string> = {}

const insertId = async (sql: string, params: unknown[]) => (await pool.query<{ id: string }>(`${sql} returning id`, params)).rows[0]!.id

async function cleanup() {
  for (const org of [ORG_A, ORG_B]) {
    for (const table of ["audit_logs", "personal_data_access_log", "data_ingestion_rejections", "data_ingestion_runs", "data_feeds", "data_sources", "feedbacks", "supervision_cases", "employee_status_periods", "employee_schedule_exceptions", "employee_schedule_days", "employee_work_shifts", "goals", "employee_prv_performance", "employee_indicator_performance", "indicator_measurements", "interaction_flags", "transcripts", "interactions", "channel_flags", "indicator_definitions", "access_role_assignments", "user_accounts"]) {
      await pool.query(`delete from ${table} where organization_id = $1`, [org])
    }
    await pool.query(`update people set reports_to_id = null where organization_id = $1`, [org])
  }
  for (const org of [ORG_A, ORG_B]) await pool.query(`delete from people where organization_id = $1`, [org])
  for (const org of [ORG_A, ORG_B]) {
    await pool.query(`delete from subteams where organization_id = $1`, [org])
    await pool.query(`delete from teams where organization_id = $1`, [org])
    await pool.query(`delete from operations where organization_id = $1`, [org])
    await pool.query(`delete from organizations where id = $1`, [org])
  }
}

async function seed() {
  const hash = await hashPassword(PASSWORD)
  await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova consulta A', 'prova-consulta-a'), ($2, 'Prova consulta B', 'prova-consulta-b')`, [ORG_A, ORG_B])
  const operation = async (org: string) => insertId(`insert into operations (organization_id, name, timezone) values ($1, 'Operação', 'America/Sao_Paulo')`, [org])
  const teamA = await insertId(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo A', 'GA')`, [ORG_A, await operation(ORG_A)])
  const teamB = await insertId(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo B', 'GB')`, [ORG_B, await operation(ORG_B)])
  const subteamA = await insertId(`insert into subteams (organization_id, team_id, name) values ($1, $2, 'Subgrupo A')`, [ORG_A, teamA])
  const person = async (key: string, org: string, team: string | null, name: string, matricula: string | null, extra: { role?: string; status?: string; role_code?: string; scope?: string } = {}) => {
    const id = await insertId(`insert into people (organization_id, team_id, name, role, job_title, matricula, current_employment_status) values ($1, $2, $3, $4, 'Assistente', $5, $6)`, [org, team, name, extra.role ?? "OPERATOR", matricula, extra.status ?? "EM_PRODUCAO"])
    ids[key] = id
    return id
  }
  const account = async (key: string, org: string, personId: string, role?: string, scopeTeam?: string) => {
    const accountId = await insertId(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4)`, [org, personId, `${key}@prova-consulta.inia.local`, hash])
    accountIds[key] = accountId
    if (role) await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())`, [org, accountId, role, scopeTeam ? "GROUP" : "ORGANIZATION", scopeTeam ?? null])
  }
  await account("geral", ORG_A, await person("geral", ORG_A, null, "Conta Geral", "A-GERAL", { role: "ADMIN" }), "ADMINISTRADOR_GERAL")
  await account("dados", ORG_A, await person("dados", ORG_A, null, "Conta Dados", "A-DADOS", { role: "ADMIN" }), "ADMINISTRADOR_DE_DADOS")
  await account("dados2", ORG_A, await person("dados2", ORG_A, null, "Conta Dados 2", "A-DADOS2", { role: "ADMIN" }), "ADMINISTRADOR_DE_DADOS")
  await account("administrador", ORG_A, await person("administrador", ORG_A, null, "Conta Administrador", "A-ADM", { role: "ADMIN" }), "ADMINISTRADOR")
  await account("administrador_grupo", ORG_A, await person("administrador_grupo", ORG_A, teamA, "Conta Adm Grupo", "A-ADMG", { role: "SUPERVISOR" }), "ADMINISTRADOR", teamA)
  await account("acessos", ORG_A, await person("acessos", ORG_A, null, "Conta Acessos", "A-ACE", { role: "ADMIN" }), "ADMINISTRADOR_DE_ACESSOS")
  await account("qa", ORG_A, await person("qa", ORG_A, null, "Conta QA", "A-QA", { role: "ADMIN" }), "QA_DE_FEEDBACK")
  await account("gestor", ORG_A, await person("gestor", ORG_A, teamA, "Conta Gestor", "A-SUP", { role: "SUPERVISOR" }))
  await account("geral_b", ORG_B, await person("geral_b", ORG_B, null, "Conta Geral B", "B-GERAL", { role: "ADMIN" }), "ADMINISTRADOR_GERAL")

  // Colaboradores com o que pode dar errado: fórmula no nome, afastamento sensível, sem matrícula, nomes iguais.
  ids.opA = await person("opA", ORG_A, teamA, "=HYPERLINK(\"http://malicioso\")", "A-001")
  await pool.query(`update people set subteam_id = $1, hired_at = '2024-05-10' where id = $2`, [subteamA, ids.opA])
  ids.opInss = await person("opInss", ORG_A, teamA, "Pessoa em Afastamento", "A-002", { status: "INSS" })
  ids.opMat = await person("opMat", ORG_A, teamA, "@Pessoa Maternidade", "A-003", { status: "MATERNIDADE" })
  ids.opSemMatricula = await person("opSemMatricula", ORG_A, null, "Pessoa Sem Matrícula", null)
  ids.opB = await person("opB", ORG_B, teamB, "Pessoa da Organização B", "B-001")

  // Interações com empate no início (a paginação não pode perder nem repetir), texto de ataque e uma chamada de madrugada para o teste de fuso.
  const interaction = (org: string, operator: string, protocol: string, reason: string, startedAt: string, subReason: string | null = null) => insertId(`insert into interactions (organization_id, operator_id, external_id, reason, sub_reason, channel, started_at, ended_at) values ($1, $2, $3, $4, $5, 'VOICE', $6, $6::timestamptz + interval '5 minutes')`, [org, operator, protocol, reason, subReason, startedAt])
  const tie = "2026-03-05T12:00:00Z"
  for (let index = 1; index <= 7; index += 1) ids[`i${index}`] = await interaction(ORG_A, ids.opA!, `A-P${index}`, index % 2 === 0 ? "Fatura" : "Cancelamento", tie, index === 1 ? "Segunda via" : null)
  ids.iAttack = await interaction(ORG_A, ids.opA!, "' OR '1'='1", "Fatura'; drop table people; --", "2026-03-06T12:00:00Z")
  ids.iNight = await interaction(ORG_A, ids.opA!, "A-NOITE", "Madrugada", "2026-03-10T02:30:00Z")
  ids.iB = await interaction(ORG_B, ids.opB!, "B-P1", "Fatura", tie)
  // Referência cruzada (o banco não impede): a matrícula da outra organização não pode aparecer pela junção.
  ids.iCross = await interaction(ORG_A, ids.opB!, "A-CRUZADA", "Cruzada", "2026-03-07T12:00:00Z")

  await pool.query(`insert into transcripts (organization_id, interaction_id, version, content, language) values ($1, $2, 1, 'CONTEUDO-SECRETO-DA-CHAMADA cpf 123', 'pt-BR')`, [ORG_A, ids.i1])

  const indicatorA = await insertId(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operational_aggregation) values ($1, 'PROVA_TMA', 'TMA', 'SECONDS', 'LOWER', 'AVERAGE')`, [ORG_A])
  for (const [day, value] of [["2026-03-01", "100.50"], ["2026-03-02", "-5.25"], ["2026-03-03", "300"]] as const) {
    await pool.query(`insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1, $2, 'PERSON', $3, $4, ($5::date)::timestamp at time zone 'America/Sao_Paulo', ($5::date + 1)::timestamp at time zone 'America/Sao_Paulo', 'prova', 'DAILY')`, [ORG_A, indicatorA, ids.opA, value, day])
  }
  await pool.query(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, source, quartile) values ($1, $2, $3, '2026-02', 10, 'prova', 'Q1'), ($1, $2, $3, '2026-03', 20, 'prova', 'Q2')`, [ORG_A, ids.opA, indicatorA])
  await pool.query(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, 'TEXTO-DO-TITULO Acompanhamento', 'TEXTO-DO-RESUMO', 'ACTION_PENDING', 'P2', 'POLICY:prova_secreta', '1', '2')`, [ORG_A, ids.opA, teamA])
  await pool.query(`insert into employee_status_periods (organization_id, person_id, status, raw_status, effective_from, observed_at, source) values ($1, $2, 'INSS', 'INSS CID J11', '2026-01-01', now(), 'prova')`, [ORG_A, ids.opInss])
  await pool.query(`insert into employee_schedule_exceptions (organization_id, person_id, exception_date, code, effect, raw_reason, observed_at, source) values ($1, $2, '2026-03-01', 'ATESTADO', 'NON_WORKING', 'CID J11 gripe', now(), 'prova'), ($1, $2, '2026-03-02', 'DAY_OFF', 'NON_WORKING', 'folga', now(), 'prova')`, [ORG_A, ids.opA])
}

type Agent = ReturnType<typeof request.agent>

async function login(app: ReturnType<typeof createApp>, key: string): Promise<Agent> {
  const agent = request.agent(app)
  const response = await agent.post("/api/v1/auth/login").send({ email: `${key}@prova-consulta.inia.local`, password: PASSWORD })
  expect(response.status, key).toBe(200)
  return agent
}

const newApp = (options: CreateAppOptions = {}) => createApp(pool as unknown as Database, { rateLimits: false, ...options })
const where = (...children: unknown[]) => ({ type: "group", logic: "AND", children })
const condition = (column: string, operator: string, extra: Record<string, unknown> = {}) => ({ type: "condition", column, operator, ...extra })
const protocols = (body: { data: { columns: string[]; rows: (string | null)[][] } }) => {
  const index = body.data.columns.indexOf("protocol")
  return body.data.rows.map((row) => row[index])
}
const lastAudit = async (action: string, person: string) => (await pool.query<{ actor_id: string; action: string; entity_type: string; payload: Record<string, unknown>; created_at: Date }>(`select actor_id, action, entity_type, payload, created_at from audit_logs where organization_id = $1 and action = $2 and actor_id = $3 order by created_at desc limit 1`, [ORG_A, action, person])).rows[0]
const everyAuditText = async () => JSON.stringify((await pool.query(`select payload from audit_logs where organization_id = any($1::uuid[])`, [[ORG_A, ORG_B]])).rows)

describe.skipIf(!ENABLED)("Consulta de dados da Central — prova Postgres", () => {
  let app: ReturnType<typeof createApp>
  let geral: Agent
  let dados: Agent

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    await seed()
    app = newApp()
    geral = await login(app, "geral")
    dados = await login(app, "dados")
  }, 60_000)

  afterAll(async () => {
    if (pool) {
      await cleanup()
      await pool.end()
    }
  }, 60_000)

  describe("acesso", () => {
    const calls = (agent: Agent) => [
      () => agent.get(`${API}/datasets`),
      () => agent.get(`${API}/datasets/interactions`),
      () => agent.post(`${API}/query`).send({ dataset: "interactions" }),
      () => agent.post(`${API}/count`).send({ dataset: "interactions" }),
      () => agent.post(`${API}/export`).send({ dataset: "interactions" }),
    ]

    it("sem sessão: 401 em todas as rotas", async () => {
      for (const call of calls(request.agent(app))) expect((await call()).status).toBe(401)
    })

    it.each(["administrador", "administrador_grupo", "acessos", "qa", "gestor"])("%s: 403 em todas as rotas, por chamada direta, e a tentativa fica registrada", async (key) => {
      const agent = await login(app, key)
      for (const call of calls(agent)) {
        const response = await call()
        expect(response.status).toBe(403)
        expect(JSON.stringify(response.body)).not.toContain("interactions")
      }
      const audit = await lastAudit("DATA_HUB_EXPLORER_DENIED", ids[key]!)
      expect(audit?.payload).toMatchObject({ result: "DENIED", scope: "ORGANIZATION" })
    })

    it("Administrador geral e Administrador de dados consultam", async () => {
      for (const agent of [geral, dados]) {
        expect((await agent.get(`${API}/datasets`)).status).toBe(200)
        expect((await agent.post(`${API}/query`).send({ dataset: "interactions" })).status).toBe(200)
      }
    })

    it("a capacidade do /auth/me segue a permissão", async () => {
      expect((await dados.get("/api/v1/auth/me")).body.data.access.capabilities.canExploreData).toBe(true)
      expect((await (await login(app, "administrador")).get("/api/v1/auth/me")).body.data.access.capabilities.canExploreData).toBe(false)
    })

    it("revogar o papel vale na hora, sem novo login", async () => {
      const agent = await login(app, "dados2")
      expect((await agent.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(200)
      await pool.query(`update access_role_assignments set revoked_at = now() where user_account_id = $1`, [accountIds.dados2])
      expect((await agent.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(403)
      await pool.query(`update access_role_assignments set revoked_at = null where user_account_id = $1`, [accountIds.dados2])
    })

    it("conjunto com permissão própria: Uso de IA só para quem tem `ai.view`, sem revelar que existe", async () => {
      const codesFor = async (agent: Agent) => (await agent.get(`${API}/datasets`)).body.data.datasets.map((dataset: { code: string }) => dataset.code)
      expect(await codesFor(geral)).toContain("ai_usage")
      expect(await codesFor(dados)).not.toContain("ai_usage")
      expect((await dados.get(`${API}/datasets/ai_usage`)).status).toBe(404)
      const refused = await dados.post(`${API}/query`).send({ dataset: "ai_usage" })
      expect(refused.status).toBe(404)
      expect(refused.body.error.code).toBe("DATA_EXPLORER_DATASET_NOT_FOUND")
      expect((await dados.post(`${API}/export`).send({ dataset: "ai_usage" })).status).toBe(404)
      expect((await geral.post(`${API}/query`).send({ dataset: "ai_usage" })).status).toBe(200)
    })

    it("caso e feedback por pessoa exigem `indicators.view`: o Administrador de dados não vê, o Administrador geral vê", async () => {
      const codes = (await dados.get(`${API}/datasets`)).body.data.datasets.map((dataset: { code: string }) => dataset.code)
      for (const dataset of ["supervision_cases", "feedbacks"]) {
        expect(codes).not.toContain(dataset)
        expect((await dados.get(`${API}/datasets/${dataset}`)).status).toBe(404)
        for (const route of ["query", "count", "export"]) expect((await dados.post(`${API}/${route}`).send({ dataset })).status, `${route} ${dataset}`).toBe(404)
        expect((await geral.post(`${API}/query`).send({ dataset })).status).toBe(200)
      }
    })

    it("nenhuma rota de escrita", async () => {
      for (const method of ["put", "patch", "delete"] as const) {
        for (const path of ["/datasets", "/datasets/interactions", "/query", "/export"]) expect((await geral[method](`${API}${path}`).send({})).status, `${method} ${path}`).toBe(404)
      }
    })
  })

  describe("isolamento entre organizações", () => {
    it("a sessão decide a organização: cada uma só vê o que é dela", async () => {
      const other = await login(app, "geral_b")
      const own = await geral.post(`${API}/query`).send({ dataset: "interactions", pageSize: 100 })
      expect(protocols(own.body)).toContain("A-P1")
      expect(protocols(own.body)).not.toContain("B-P1")
      const theirs = await other.post(`${API}/query`).send({ dataset: "interactions", pageSize: 100 })
      expect(protocols(theirs.body)).toEqual(["B-P1"])
    })

    it("filtro, busca, contagem e CSV pela chave da outra organização não acham nada", async () => {
      const filter = where(condition("protocol", "EQ", { value: "B-P1" }))
      expect((await geral.post(`${API}/query`).send({ dataset: "interactions", filter })).body.data.rows).toEqual([])
      expect((await geral.post(`${API}/query`).send({ dataset: "interactions", search: "B-P1" })).body.data.rows).toEqual([])
      expect((await geral.post(`${API}/count`).send({ dataset: "interactions", filter })).body.data.count).toBe(0)
      const csv = await geral.post(`${API}/export`).send({ dataset: "interactions", filter })
      expect(csv.status).toBe(200)
      expect(csv.text).not.toContain("B-P1")
    })

    it("mandar a organização no corpo é recusado, não obedecido", async () => {
      for (const route of ["query", "count", "export"]) {
        const response = await geral.post(`${API}/${route}`).send({ dataset: "interactions", organizationId: ORG_B })
        expect(response.status, route).toBe(400)
        expect(response.body.error.code).toBe("DATA_EXPLORER_INVALID_REQUEST")
      }
    })

    it("referência cruzada no banco não vaza pela junção", async () => {
      const response = await geral.post(`${API}/query`).send({ dataset: "interactions", columns: ["protocol", "operator_matricula"], filter: where(condition("protocol", "EQ", { value: "A-CRUZADA" })) })
      expect(response.body.data.rows).toEqual([["A-CRUZADA", null]])
    })

    it("posição forjada com o registro da outra organização não traz nada de lá", async () => {
      const first = await geral.post(`${API}/query`).send({ dataset: "interactions", pageSize: 1 })
      const decoded = JSON.parse(Buffer.from(first.body.data.nextCursor, "base64url").toString()) as { f: string; s: string; k: string }
      const forged = Buffer.from(JSON.stringify({ ...decoded, k: ids.iB })).toString("base64url")
      const response = await geral.post(`${API}/query`).send({ dataset: "interactions", pageSize: 100, cursor: forged })
      expect(response.status).toBe(200)
      expect(protocols(response.body)).not.toContain("B-P1")
    })
  })

  describe("lista permitida", () => {
    it("tabelas internas não existem para a consulta", async () => {
      for (const dataset of ["user_accounts", "data_secrets", "auth_revoked_sessions", "access_role_assignments", "audit_logs", "assistant_interactions", "pg_user", "information_schema", "data_push_tokens", "ai_connection_secrets"]) {
        for (const route of ["query", "count", "export"]) {
          const response = await geral.post(`${API}/${route}`).send({ dataset })
          expect(response.status, `${route} ${dataset}`).toBe(404)
          expect(response.body.error.code).toBe("DATA_EXPLORER_DATASET_NOT_FOUND")
        }
        expect((await geral.get(`${API}/datasets/${dataset}`)).status).toBe(404)
      }
    })

    it("colunas sensíveis são recusadas na seleção, no filtro, na ordenação e no CSV, com a mesma resposta", async () => {
      for (const [dataset, column] of [["supervision_cases", "title"], ["feedbacks", "impacted_indicator"], ["data_rejections", "message"], ["data_rejections", "source_record_key"], ["data_rejections", "record_key"], ["collaborators", "password_hash"], ["collaborators", "email"], ["collaborators", "avatar_url"], ["collaborators", "bio"], ["transcripts", "content"], ["status_periods", "raw_status"], ["schedule_exceptions", "raw_reason"], ["feedbacks", "evidence_found"], ["workflow_executions", "node_outputs"], ["agent_executions", "input_context"], ["ai_usage", "requester_person_id"]] as const) {
        for (const body of [{ columns: [column] }, { filter: where(condition(column, "EQ", { value: "x" })) }, { sort: { column, direction: "ASC" } }]) {
          for (const route of ["query", "export"]) {
            const response = await geral.post(`${API}/${route}`).send({ dataset, ...body })
            expect(response.status, `${route} ${dataset}.${column}`).toBe(422)
            expect(response.body.error.code).toBe("DATA_EXPLORER_COLUMN_NOT_ALLOWED")
            expect(response.body.error.message).not.toContain(column)
          }
        }
      }
    })

    it("o texto da transcrição, os motivos brutos e os e-mails não saem por nenhum caminho", async () => {
      const transcript = await geral.post(`${API}/query`).send({ dataset: "transcripts", columns: ["protocol", "characters", "version"] })
      expect(transcript.body.data.rows).toEqual([["A-P1", "35", "1"]])
      const outputs = [
        JSON.stringify(transcript.body),
        (await geral.post(`${API}/export`).send({ dataset: "transcripts" })).text,
        JSON.stringify((await geral.post(`${API}/query`).send({ dataset: "status_periods" })).body),
        JSON.stringify((await geral.post(`${API}/query`).send({ dataset: "schedule_exceptions" })).body),
        (await geral.post(`${API}/export`).send({ dataset: "status_periods" })).text,
        JSON.stringify((await geral.post(`${API}/query`).send({ dataset: "collaborators", pageSize: 100 })).body),
      ].join("\n")
      expect(outputs).not.toContain("CONTEUDO-SECRETO")
      expect(outputs).not.toContain("CID J11")
      expect(outputs).not.toContain("prova-consulta.inia.local")
      expect(outputs).not.toContain("$2")
    })

    it("caso aberto por política não revela a política, nem por filtro ou busca", async () => {
      const rows = (await geral.post(`${API}/query`).send({ dataset: "supervision_cases", columns: ["indicator_code", "operator_matricula"], filter: where(condition("indicator_code", "EQ", { value: "POLITICA_DE_ACOMPANHAMENTO" })) })).body.data.rows
      expect(rows).toEqual([["POLITICA_DE_ACOMPANHAMENTO", "A-001"]])
      expect((await geral.post(`${API}/query`).send({ dataset: "supervision_cases", filter: where(condition("indicator_code", "EQ", { value: "POLICY:prova_secreta" })) })).body.data.rows).toEqual([])
      expect((await geral.post(`${API}/query`).send({ dataset: "supervision_cases", search: "POLICY:prova_secreta" })).body.data.rows).toEqual([])
      const everything = await geral.post(`${API}/export`).send({ dataset: "supervision_cases" })
      expect(everything.text).not.toContain("prova_secreta")
      expect(everything.text).not.toContain("TEXTO-DO-TITULO")
      expect(everything.text).not.toContain("TEXTO-DO-RESUMO")
    })

    it("afastamento sensível e atestado saem mascarados na tela, no CSV e no filtro, sem como descobrir por filtro", async () => {
      const filter = where(condition("employment_status", "EQ", { value: "AFASTAMENTO_PROTEGIDO" }))
      const rows = (await geral.post(`${API}/query`).send({ dataset: "collaborators", columns: ["matricula", "employment_status"], filter, sort: { column: "matricula", direction: "ASC" } })).body.data.rows
      expect(rows).toEqual([["A-002", "AFASTAMENTO_PROTEGIDO"], ["A-003", "AFASTAMENTO_PROTEGIDO"]])
      expect((await geral.post(`${API}/query`).send({ dataset: "collaborators", filter: where(condition("employment_status", "EQ", { value: "INSS" })) })).status).toBe(422)
      const csv = await geral.post(`${API}/export`).send({ dataset: "collaborators", columns: ["matricula", "employment_status"], filter })
      expect(csv.text).toContain("A-002;AFASTAMENTO_PROTEGIDO")
      expect(csv.text).not.toContain("INSS")
      expect(csv.text).not.toContain("MATERNIDADE")
      const periods = (await geral.post(`${API}/query`).send({ dataset: "status_periods", columns: ["matricula", "status"] })).body.data.rows
      expect(periods).toEqual([["A-002", "AFASTAMENTO_PROTEGIDO"]])
      const exceptions = (await geral.post(`${API}/query`).send({ dataset: "schedule_exceptions", columns: ["exception_date", "code"] })).body.data.rows
      expect(exceptions).toEqual([["2026-03-02", "DAY_OFF"], ["2026-03-01", "MOTIVO_PROTEGIDO"]])
    })
  })

  describe("resistência a injeção", () => {
    const ATTACKS = [`' OR '1'='1`, `'; drop table people; --`, `" OR ""="`, `\\'; select pg_sleep(30); --`, `%' OR 1=1 --`, `$1`, `::text`, `) or (1=1`]

    it("valor de filtro e de lista é só valor", async () => {
      const before = (await pool.query<{ n: number }>(`select count(*)::int n from people`)).rows[0]!.n
      for (const attack of ATTACKS) {
        const eq = await geral.post(`${API}/query`).send({ dataset: "interactions", filter: where(condition("reason", "EQ", { value: attack })) })
        expect(eq.status, attack).toBe(200)
        expect(eq.body.data.rows, attack).toEqual([])
        const list = await geral.post(`${API}/query`).send({ dataset: "interactions", filter: where(condition("reason", "IN", { values: [attack, `${attack}2`] })) })
        expect(list.body.data.rows, attack).toEqual([])
      }
      // O texto de ataque guardado como dado é encontrado por igualdade, e nada além dele.
      const stored = await geral.post(`${API}/query`).send({ dataset: "interactions", filter: where(condition("protocol", "EQ", { value: "' OR '1'='1" })) })
      expect(protocols(stored.body)).toEqual(["' OR '1'='1"])
      expect((await pool.query<{ n: number }>(`select count(*)::int n from people`)).rows[0]!.n).toBe(before)
    })

    it("busca é só valor, e curinga é tratado como texto", async () => {
      for (const attack of ATTACKS) {
        const response = await geral.post(`${API}/query`).send({ dataset: "interactions", search: attack })
        expect(response.status, attack).toBe(200)
        expect(protocols(response.body).filter((protocol) => protocol !== attack), attack).toEqual([])
      }
      expect((await geral.post(`${API}/query`).send({ dataset: "collaborators", search: "%%" })).body.data.rows).toEqual([])
      expect((await geral.post(`${API}/query`).send({ dataset: "collaborators", search: "__" })).body.data.rows).toEqual([])
      expect((await geral.post(`${API}/query`).send({ dataset: "collaborators", columns: ["name"], search: "Conta Dados 2" })).body.data.rows).toEqual([["Conta Dados 2"]])
    })

    it("ordenação, identificadores e direção recusam qualquer coisa fora dos metadados", async () => {
      const bodies = [
        { dataset: "interactions", sort: { column: "started_at, (select pg_sleep(30))", direction: "ASC" } },
        { dataset: "interactions", sort: { column: "started_at", direction: "ASC, (select 1)" } },
        { dataset: "interactions", columns: ["protocol", "(select password_hash from user_accounts limit 1)"] },
        { dataset: "interactions; drop table people" },
        { dataset: "interactions", filter: where(condition("reason = reason or 1=1 --", "EQ", { value: "x" })) },
        { dataset: "interactions", filter: where(condition("reason", "EQ or 1=1", { value: "x" })) },
        { dataset: "interactions", filter: { type: "group", logic: "AND 1=1 OR", children: [condition("reason", "EQ", { value: "x" })] } },
      ]
      for (const body of bodies) {
        const response = await geral.post(`${API}/query`).send(body)
        expect([400, 422], JSON.stringify(body)).toContain(response.status)
        expect(JSON.stringify(response.body)).not.toMatch(/pg_sleep|password_hash|drop table/)
      }
    })

    it("tipos: número e data com texto de ataque são recusados antes de chegar ao banco", async () => {
      for (const body of [{ dataset: "indicator_measurements", filter: where(condition("value", "GT", { value: "1 or 1=1" })) }, { dataset: "interactions", filter: where(condition("started_at", "GTE", { value: "2026-01-01'; drop table people; --" })) }, { dataset: "feedbacks", filter: where(condition("id", "EQ", { value: "x' or '1'='1" })) }]) {
        const response = await geral.post(`${API}/query`).send(body)
        expect(response.status).toBe(422)
        expect(response.body.error.code).toBe("DATA_EXPLORER_INVALID_VALUE")
      }
    })

    it("posição adulterada é recusada", async () => {
      const first = await geral.post(`${API}/query`).send({ dataset: "interactions", pageSize: 1 })
      const decoded = JSON.parse(Buffer.from(first.body.data.nextCursor, "base64url").toString()) as { f: string; s: string; k: string }
      for (const tampered of [{ ...decoded, s: "2026-01-01'; drop table people; --" }, { ...decoded, k: "1 or 1=1" }, { ...decoded, f: "outra" }]) {
        const response = await geral.post(`${API}/query`).send({ dataset: "interactions", cursor: Buffer.from(JSON.stringify(tampered)).toString("base64url") })
        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe("DATA_EXPLORER_INVALID_CURSOR")
      }
    })
  })

  describe("filtros, ordenação e paginação", () => {
    const query = (body: Record<string, unknown>) => geral.post(`${API}/query`).send({ dataset: "interactions", pageSize: 100, ...body })

    it("igualdade, diferente, lista, vazio e preenchido", async () => {
      expect(protocols((await query({ filter: where(condition("reason", "EQ", { value: "Madrugada" })) })).body)).toEqual(["A-NOITE"])
      expect((await query({ filter: where(condition("reason", "IN", { values: ["Madrugada", "Cruzada"] })), sort: { column: "protocol", direction: "ASC" } })).body.data.rows.length).toBe(2)
      expect(protocols((await query({ filter: where(condition("sub_reason", "IS_NOT_EMPTY")) })).body)).toEqual(["A-P1"])
      const empty = await query({ filter: where(condition("sub_reason", "IS_EMPTY")) })
      expect(protocols(empty.body)).not.toContain("A-P1")
      expect(protocols(empty.body)).toContain("A-NOITE")
      const different = await query({ filter: where(condition("sub_reason", "NEQ", { value: "Segunda via" })) })
      expect(protocols(different.body)).not.toContain("A-P1")
      expect(protocols(different.body)).toContain("A-NOITE")
    })

    it("data no fuso da organização: 02h30 UTC do dia 10 é o dia 09 em São Paulo", async () => {
      expect(protocols((await query({ filter: where(condition("started_at", "EQ", { value: "2026-03-09" })) })).body)).toEqual(["A-NOITE"])
      expect((await query({ filter: where(condition("started_at", "EQ", { value: "2026-03-10" })) })).body.data.rows).toEqual([])
      expect(protocols((await query({ filter: where(condition("started_at", "LTE", { value: "2026-03-05" })) })).body).length).toBe(7)
      expect(protocols((await query({ filter: where(condition("started_at", "GTE", { value: "2026-03-08" })) })).body)).toEqual(["A-NOITE"])
      expect(protocols((await query({ filter: where(condition("started_at", "BETWEEN", { values: ["2026-03-06", "2026-03-07"] })), sort: { column: "protocol", direction: "ASC" } })).body)).toEqual(["' OR '1'='1", "A-CRUZADA"])
    })

    it("intervalos numéricos e de competência", async () => {
      const measurement = (filter: unknown) => geral.post(`${API}/query`).send({ dataset: "indicator_measurements", columns: ["value"], recordStatus: "ACTIVE", filter })
      expect((await measurement(where(condition("value", "GT", { value: 100.5 })))).body.data.rows).toEqual([["300"]])
      expect((await measurement(where(condition("value", "LT", { value: 0 })))).body.data.rows).toEqual([["-5.25"]])
      expect((await measurement(where(condition("value", "BETWEEN", { values: ["0", "200"] })))).body.data.rows).toEqual([["100.50"]])
      const closure = await geral.post(`${API}/query`).send({ dataset: "official_closures", columns: ["reference_period", "value"], filter: where(condition("reference_period", "GTE", { value: "2026-03" })) })
      expect(closure.body.data.rows.map((row: string[]) => row[0])).toEqual(["2026-03"])
    })

    it("AND e OR combinados", async () => {
      const filter = { type: "group", logic: "OR", children: [where(condition("reason", "EQ", { value: "Fatura" }), condition("protocol", "EQ", { value: "A-P2" })), where(condition("reason", "EQ", { value: "Madrugada" }))] }
      expect(protocols((await query({ filter, sort: { column: "protocol", direction: "ASC" } })).body)).toEqual(["A-NOITE", "A-P2"])
    })

    it("busca só nos campos liberados", async () => {
      expect(protocols((await query({ search: "A-P3" })).body)).toEqual(["A-P3"])
      expect(protocols((await query({ search: "A-001" })).body).length).toBeGreaterThan(1)
      expect((await geral.post(`${API}/query`).send({ dataset: "collaborators", columns: ["matricula"], search: "afastamento" })).body.data.rows).toEqual([["A-002"]])
    })

    it.each(["DESC", "ASC"] as const)("paginação por posição %s não perde nem repete, mesmo com empate", async (direction) => {
      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page += 1) {
        const body: Record<string, unknown> = { pageSize: 3, sort: { column: "started_at", direction }, ...(cursor ? { cursor } : {}) }
        const response = await query(body)
        expect(response.status).toBe(200)
        seen.push(...(protocols(response.body) as string[]))
        cursor = response.body.data.nextCursor ?? undefined
        if (!cursor) break
      }
      const expected = (await pool.query<{ external_id: string }>(`select external_id from interactions where organization_id = $1 order by started_at ${direction.toLowerCase()}, id ${direction.toLowerCase()}`, [ORG_A])).rows.map((row) => row.external_id)
      expect(seen).toEqual(expected)
    })

    it.each(["ASC", "DESC"] as const)("coluna que aceita vazio: paginação %s atravessa os vazios sem perder ninguém", async (direction) => {
      const seen: (string | null)[] = []
      let cursor: string | undefined
      for (let page = 0; page < 30; page += 1) {
        const response = await geral.post(`${API}/query`).send({ dataset: "collaborators", columns: ["matricula", "name"], pageSize: 2, sort: { column: "matricula", direction }, ...(cursor ? { cursor } : {}) })
        expect(response.status).toBe(200)
        seen.push(...response.body.data.rows.map((row: (string | null)[]) => row[0]))
        cursor = response.body.data.nextCursor ?? undefined
        if (!cursor) break
      }
      const expected = (await pool.query<{ matricula: string | null }>(`select matricula from people where organization_id = $1 order by matricula ${direction.toLowerCase()}, id ${direction.toLowerCase()}`, [ORG_A])).rows.map((row) => row.matricula)
      expect(seen).toEqual(expected)
      expect(seen).toContain(null)
    })

    it("contagem nunca passa do teto", async () => {
      expect((await geral.post(`${API}/count`).send({ dataset: "interactions" })).body.data).toMatchObject({ count: 10, capped: false })
      const capped = newApp({ dataExplorerLimits: { countCap: 3 } })
      const response = await (await login(capped, "geral")).post(`${API}/count`).send({ dataset: "interactions" })
      expect(response.body.data).toMatchObject({ count: 3, capped: true })
    })
  })

  describe("cada conjunto contra o esquema real", () => {
    it("todas as colunas, em todos os conjuntos, leem no banco", async () => {
      for (const dataset of EXPLORER_DATASETS) {
        const response = await geral.post(`${API}/query`).send({ dataset: dataset.code, columns: dataset.columns.map((column) => column.key) })
        expect(response.status, `${dataset.code}: ${JSON.stringify(response.body.error)}`).toBe(200)
      }
    })

    it("cada filtro e cada ordenação executam, nas duas direções", async () => {
      const sample = (column: (typeof EXPLORER_DATASETS)[number]["columns"][number]) => {
        switch (column.type) {
          case "BOOLEAN": return { operator: "EQ", value: true }
          case "NUMBER": return { operator: "GTE", value: "0" }
          case "DATE":
          case "DATETIME": return { operator: "GTE", value: "2020-01-01" }
          case "TIME": return { operator: "GTE", value: "08:00" }
          case "MONTH": return { operator: "GTE", value: "2020-01" }
          case "UUID": return { operator: "EQ", value: "00000000-0000-4000-8000-000000000000" }
          case "ENUM": return { operator: "EQ", value: column.options![0]!.value }
          case "TEXT": return { operator: "EQ", value: "x" }
        }
      }
      for (const dataset of EXPLORER_DATASETS) {
        for (const column of dataset.columns) {
          if (column.filterable) {
            const response = await geral.post(`${API}/query`).send({ dataset: dataset.code, filter: where({ type: "condition", column: column.key, ...sample(column) }) })
            expect(response.status, `${dataset.code}.${column.key}: ${JSON.stringify(response.body.error)}`).toBe(200)
          }
          if (column.sortable) {
            for (const direction of ["ASC", "DESC"]) {
              const response = await geral.post(`${API}/query`).send({ dataset: dataset.code, sort: { column: column.key, direction } })
              expect(response.status, `${dataset.code} ordena ${column.key}: ${JSON.stringify(response.body.error)}`).toBe(200)
            }
          }
        }
      }
    }, 60_000)

    it("as opções dos tipos do banco são as mesmas do catálogo", async () => {
      const labels = async (type: string) => (await pool.query<{ enumlabel: string }>(`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1 order by 1`, [type])).rows.map((row) => row.enumlabel)
      const options = (dataset: string, column: string) => findExplorerDataset(dataset)!.columns.find((candidate) => candidate.key === column)!.options!.map((option) => option.value).sort()
      expect(options("supervision_cases", "status")).toEqual(await labels("case_status"))
      expect(options("supervision_cases", "priority")).toEqual(await labels("case_priority"))
      expect(options("feedbacks", "status")).toEqual(await labels("feedback_status"))
      expect(options("feedbacks", "kind")).toEqual(await labels("feedback_kind"))
    })

    it("conjunto grande: a ordenação vem do índice, sem ordenar a tabela", async () => {
      const client = await pool.connect()
      try {
        await client.query("begin")
        await client.query("set local enable_seqscan = off")
        await client.query("set local enable_sort = off")
        for (const dataset of EXPLORER_DATASETS.filter((candidate) => candidate.volume === "LARGE")) {
          for (const column of dataset.columns.filter((candidate) => candidate.sortable)) {
            for (const direction of ["DESC", "ASC"]) {
              const query = resolveExplorerQuery(parseExplorerRequest({ dataset: dataset.code, sort: { column: column.key, direction } }), dataset, limits)
              const compiled = compilePageQuery(query, { organizationId: ORG_A, timeZone: "UTC", pageSize: 25, cursor: null })
              const plan = JSON.stringify((await client.query(`explain (format json) ${compiled.sql}`, compiled.params)).rows[0])
              expect(plan.includes('"Node Type":"Sort"'), `${dataset.code}.${column.key} ${direction}: ${plan}`).toBe(false)
            }
          }
        }
      } finally {
        await client.query("rollback")
        client.release()
      }
    })
  })

  describe("somente leitura pelo banco", () => {
    const session = { kind: "QUERY" as const, organizationId: ORG_A, accountId: "00000000-0000-4000-8000-0000000000aa", limits }

    it("mesmo código com um comando de escrita é recusado pelo PostgreSQL", async () => {
      const before = (await pool.query<{ n: number }>(`select count(*)::int n from organizations where id = $1`, [ORG_A])).rows[0]!.n
      for (const statement of [`insert into organizations (name, slug) values ('x', 'x-consulta')`, `update people set name = 'x' where organization_id = '${ORG_A}'`, `delete from people where organization_id = '${ORG_A}'`, `create table prova_consulta (id int)`, `drop table audit_logs`, `select nextval('ai_usage_events_id_seq')`]) {
        await expect(withExplorerSession(pool as unknown as Database, session, (client) => client.query(statement)), statement).rejects.toMatchObject({ code: "DATA_EXPLORER_QUERY_FAILED", statusCode: 500 })
      }
      expect((await pool.query<{ n: number }>(`select count(*)::int n from organizations where id = $1`, [ORG_A])).rows[0]!.n).toBe(before)
      expect((await pool.query(`select to_regclass('prova_consulta') t`)).rows[0].t).toBeNull()
    })

    it("a sessão é mesmo somente leitura, com os limites aplicados e sem efeito depois", async () => {
      const client = await pool.connect()
      const inner = { connect: async () => client } as unknown as Database
      const original = client.release
      client.release = () => undefined as never
      try {
        const seen = await withExplorerSession(inner, session, async (held) => (await held.query<Record<string, string>>(`select current_setting('transaction_read_only') ro, current_setting('statement_timeout') st, current_setting('lock_timeout') lt, current_setting('TimeZone') tz, current_setting('max_parallel_workers_per_gather') pw`)).rows[0])
        expect(seen).toMatchObject({ ro: "on", st: "5s", lt: "1s", tz: "UTC", pw: "0" })
        const after = (await client.query<Record<string, string>>(`select current_setting('transaction_read_only') ro, current_setting('statement_timeout') st`)).rows[0]
        expect(after).toMatchObject({ ro: "off" })
        expect(after?.st).not.toBe("5s")
      } finally {
        client.release = original
        client.release()
      }
    })
  })

  describe("limites do servidor", () => {
    it("página, condições, profundidade e lista além do limite", async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ pageSize: 1_000_000 }, "DATA_EXPLORER_PAGE_SIZE_EXCEEDED"],
        [{ filter: where(...Array.from({ length: 13 }, () => condition("reason", "EQ", { value: "a" }))) }, "DATA_EXPLORER_FILTER_LIMIT"],
        [{ filter: { type: "group", logic: "AND", children: [{ type: "group", logic: "OR", children: [{ type: "group", logic: "AND", children: [{ type: "group", logic: "AND", children: [condition("reason", "EQ", { value: "a" })] }] }] }] } }, "DATA_EXPLORER_FILTER_LIMIT"],
        [{ filter: where(condition("reason", "IN", { values: Array.from({ length: 51 }, (_, index) => `v${index}`) })) }, "DATA_EXPLORER_LIST_LIMIT"],
      ]
      for (const [body, code] of cases) {
        const response = await geral.post(`${API}/query`).send({ dataset: "interactions", ...body })
        expect(response.status, code).toBe(422)
        expect(response.body.error.code).toBe(code)
      }
    })

    it("a resposta tem no máximo o tamanho pedido", async () => {
      const response = await geral.post(`${API}/query`).send({ dataset: "interactions", pageSize: 2 })
      expect(response.body.data.rows.length).toBe(2)
      expect(response.body.data.hasMore).toBe(true)
      expect(response.body.data.nextCursor).toEqual(expect.any(String))
    })

    /** Trava a tabela para a consulta ficar presa no banco de forma previsível. Só `interactions`: a sessão não lê essa tabela. */
    async function withLockedInteractions<T>(work: () => Promise<T>): Promise<T> {
      const blocker = await pool.connect()
      try {
        await blocker.query("begin")
        await blocker.query("lock table interactions in access exclusive mode")
        return await work()
      } finally {
        await blocker.query("rollback")
        blocker.release()
      }
    }
    const waitForLocks = async (count: number) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const held = (await pool.query<{ n: number }>(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%interactions t%'`)).rows[0]!.n
        if (held >= count) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error("a consulta não chegou a esperar a trava")
    }

    it("tempo: a consulta é interrompida e a mensagem pede para restringir, sem nada do banco", async () => {
      const slow = newApp({ dataExplorerLimits: { queryTimeoutMs: 300, lockTimeoutMs: 60_000 } })
      const agent = await login(slow, "dados")
      await withLockedInteractions(async () => {
        const started = Date.now()
        const response = await agent.post(`${API}/query`).send({ dataset: "interactions" })
        expect(Date.now() - started).toBeLessThan(5_000)
        expect(response.status).toBe(422)
        expect(response.body.error.code).toBe("DATA_EXPLORER_QUERY_TIMEOUT")
        expect(response.body.error.message).toMatch(/Restrinja os filtros/)
        expect(JSON.stringify(response.body)).not.toMatch(/statement timeout|canceling|interactions|relation/)
      })
      const audit = await lastAudit("DATA_HUB_EXPLORER_QUERY", ids.dados!)
      expect(audit?.payload).toMatchObject({ result: "REJECTED", errorCode: "DATA_EXPLORER_QUERY_TIMEOUT", dataset: "interactions" })
    })

    it("trava de tabela: recusa rápida, sem ficar na fila", async () => {
      const locked = newApp({ dataExplorerLimits: { lockTimeoutMs: 150 } })
      const agent = await login(locked, "dados")
      await withLockedInteractions(async () => {
        const response = await agent.post(`${API}/query`).send({ dataset: "interactions" })
        expect(response.status).toBe(429)
        expect(response.body.error.code).toBe("DATA_EXPLORER_BUSY")
      })
    })

    it("concorrência por conta: a segunda consulta simultânea é recusada, e a vaga volta sozinha", async () => {
      const single = newApp({ dataExplorerLimits: { maxConcurrentPerAccount: 1, lockTimeoutMs: 20_000, queryTimeoutMs: 20_000 } })
      const agent = await login(single, "dados")
      let pending: Promise<request.Response> | undefined
      await withLockedInteractions(async () => {
        pending = agent.post(`${API}/query`).send({ dataset: "interactions" }).then((response) => response)
        await waitForLocks(1)
        const second = await agent.post(`${API}/query`).send({ dataset: "groups" })
        expect(second.status).toBe(429)
        expect(second.body.error.code).toBe("DATA_EXPLORER_BUSY")
        const other = await (await login(single, "geral")).post(`${API}/query`).send({ dataset: "groups" })
        expect(other.status).toBe(200)
      })
      expect((await pending!).status).toBe(200)
      expect((await agent.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(200)
    })

    it("concorrência por organização: outra conta também espera a vaga, e outra organização não", async () => {
      const single = newApp({ dataExplorerLimits: { maxConcurrentPerOrganization: 1, lockTimeoutMs: 20_000, queryTimeoutMs: 20_000 } })
      const [first, second, otherOrg] = [await login(single, "dados"), await login(single, "geral"), await login(single, "geral_b")]
      let pending: Promise<request.Response> | undefined
      await withLockedInteractions(async () => {
        pending = first.post(`${API}/query`).send({ dataset: "interactions" }).then((response) => response)
        await waitForLocks(1)
        expect((await second.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(429)
        expect((await otherOrg.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(200)
      })
      expect((await pending!).status).toBe(200)
    })

    it("o limite vale também para o caminho escrito de outro jeito", async () => {
      const limited = newApp({ rateLimits: { dataExplorerQueriesPerAccount: 1 } })
      const agent = await login(limited, "dados")
      expect((await agent.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(200)
      expect((await agent.post(`${API}/QUERY/`).send({ dataset: "groups" })).status).toBe(429)
    })

    it("tentativas negadas também contam no limite: não enchem a auditoria sem freio", async () => {
      const limited = newApp({ rateLimits: { dataExplorerMetadataPerAccount: 2 } })
      const agent = await login(limited, "gestor")
      expect((await agent.get(`${API}/datasets`)).status).toBe(403)
      expect((await agent.get(`${API}/datasets`)).status).toBe(403)
      expect((await agent.get(`${API}/datasets`)).status).toBe(429)
    })

    it("conta sem permissão não esgota o limite da organização", async () => {
      const limited = newApp({ rateLimits: { dataExplorerQueriesPerOrganization: 1, dataExplorerExportsPerOrganization: 1 } })
      const denied = await login(limited, "gestor")
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await denied.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(403)
        expect((await denied.post(`${API}/export`).send({ dataset: "groups" })).status).toBe(403)
      }
      const allowed = await login(limited, "dados")
      expect((await allowed.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(200)
      expect((await allowed.post(`${API}/export`).send({ dataset: "groups" })).status).toBe(200)
    })

    it("frequência por conta e por organização", async () => {
      const limited = newApp({ rateLimits: { dataExplorerQueriesPerAccount: 2, dataExplorerQueriesPerOrganization: 3, dataExplorerExportsPerAccount: 1, dataExplorerExportsPerOrganization: 100 } })
      const [a, b] = [await login(limited, "dados"), await login(limited, "geral")]
      expect((await a.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(200)
      expect((await a.post(`${API}/count`).send({ dataset: "groups" })).status).toBe(200)
      const third = await a.post(`${API}/query`).send({ dataset: "groups" })
      expect(third.status).toBe(429)
      expect(third.body.error.code).toBe("RATE_LIMITED")
      expect(third.headers["retry-after"]).toBeDefined()
      expect((await b.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(200)
      expect((await b.post(`${API}/query`).send({ dataset: "groups" })).status).toBe(429)
      expect((await a.post(`${API}/export`).send({ dataset: "groups" })).status).toBe(200)
      expect((await a.post(`${API}/export`).send({ dataset: "groups" })).status).toBe(429)
    })
  })

  describe("exportação CSV", () => {
    const parse = (text: string) => text.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean)

    it("só colunas e registros pedidos, com cabeçalho seguro, sem deixar nada na memória do pedido", async () => {
      const response = await dados.post(`${API}/export`).send({ dataset: "interactions", columns: ["protocol", "reason"], filter: where(condition("reason", "EQ", { value: "Madrugada" })) })
      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toMatch(/text\/csv/)
      expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="consulta-interactions-\d{4}-\d{2}-\d{2}\.csv"$/)
      expect(response.headers["cache-control"]).toMatch(/no-store/)
      expect(response.text.startsWith("\uFEFF")).toBe(true)
      expect(parse(response.text)).toEqual(["Protocolo;Motivo", "A-NOITE;Madrugada"])
    })

    it("neutraliza fórmula vinda dos dados, mantém número e aplica fuso", async () => {
      const people = await dados.post(`${API}/export`).send({ dataset: "collaborators", columns: ["matricula", "name"], filter: where(condition("matricula", "IN", { values: ["A-001", "A-003"] })), sort: { column: "matricula", direction: "ASC" } })
      const lines = parse(people.text)
      expect(lines[1]).toBe(`A-001;"'=HYPERLINK(""http://malicioso"")"`)
      expect(lines[2]).toBe(`A-003;'@Pessoa Maternidade`)
      const measurement = parse((await dados.post(`${API}/export`).send({ dataset: "indicator_measurements", columns: ["period_start", "value"], recordStatus: "ACTIVE", sort: { column: "period_start", direction: "ASC" } })).text)
      expect(measurement[1]).toBe("2026-03-01 00:00:00;100,50")
      expect(measurement[2]).toBe("2026-03-02 00:00:00;-5,25")
    })

    it("acima do limite de linhas responde erro claro, antes de começar o arquivo", async () => {
      const small = newApp({ dataExplorerLimits: { exportMaxRows: 3 } })
      const agent = await login(small, "dados")
      const response = await agent.post(`${API}/export`).send({ dataset: "interactions" })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("DATA_EXPLORER_EXPORT_TOO_LARGE")
      expect(response.body.error.message).toMatch(/Restrinja os filtros/)
      const audit = await lastAudit("DATA_HUB_EXPLORER_EXPORT_FINISHED", ids.dados!)
      expect(audit?.payload).toMatchObject({ result: "REJECTED", errorCode: "DATA_EXPLORER_EXPORT_TOO_LARGE" })
      expect((await agent.post(`${API}/export`).send({ dataset: "interactions", filter: where(condition("reason", "EQ", { value: "Madrugada" })) })).status).toBe(200)
    })

    it("limite de bytes: a conexão cai, nunca sai um arquivo cortado como se estivesse completo", async () => {
      const small = newApp({ dataExplorerLimits: { exportMaxBytes: 40, exportFetchRows: 2 } })
      const agent = await login(small, "dados")
      const outcome = await agent.post(`${API}/export`).send({ dataset: "interactions" }).then(() => "COMPLETED" as const, () => "ABORTED" as const)
      expect(outcome).toBe("ABORTED")
      await expect.poll(async () => (await lastAudit("DATA_HUB_EXPLORER_EXPORT_FINISHED", ids.dados!))?.payload.interruption).toBe("BYTES_LIMIT")
      expect((await lastAudit("DATA_HUB_EXPLORER_EXPORT_FINISHED", ids.dados!))?.payload.result).toBe("INTERRUPTED")
    })

    it("limite de tempo total", async () => {
      const small = newApp({ dataExplorerLimits: { exportMaxDurationMs: -1 } })
      const agent = await login(small, "dados")
      const outcome = await agent.post(`${API}/export`).send({ dataset: "groups" }).then(() => "COMPLETED" as const, () => "ABORTED" as const)
      expect(outcome).toBe("ABORTED")
      await expect.poll(async () => (await lastAudit("DATA_HUB_EXPLORER_EXPORT_FINISHED", ids.dados!))?.payload.interruption).toBe("DURATION_LIMIT")
    })

    it("uma exportação por conta: a segunda é recusada enquanto a primeira roda", async () => {
      const single = newApp({ dataExplorerLimits: { maxConcurrentExportsPerAccount: 1, lockTimeoutMs: 20_000, exportFetchTimeoutMs: 20_000 } })
      const agent = await login(single, "dados")
      const blocker = await pool.connect()
      let pending: Promise<request.Response> | undefined
      try {
        await blocker.query("begin")
        await blocker.query("lock table interactions in access exclusive mode")
        pending = agent.post(`${API}/export`).send({ dataset: "interactions" }).then((response) => response)
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = (await pool.query<{ n: number }>(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%interactions t%'`)).rows[0]!.n
          if (waiting > 0) break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        const second = await agent.post(`${API}/export`).send({ dataset: "groups" })
        expect(second.status).toBe(429)
        expect(second.body.error.code).toBe("DATA_EXPLORER_EXPORT_BUSY")
      } finally {
        await blocker.query("rollback")
        blocker.release()
      }
      expect((await pending!).status).toBe(200)
    })

    it("cada exportação registra início e fim, com quantidade e duração", async () => {
      await dados.post(`${API}/export`).send({ dataset: "groups" })
      const started = await lastAudit("DATA_HUB_EXPLORER_EXPORT_STARTED", ids.dados!)
      const finished = await lastAudit("DATA_HUB_EXPLORER_EXPORT_FINISHED", ids.dados!)
      expect(started?.payload).toMatchObject({ dataset: "groups", result: "OK", scope: "ORGANIZATION", accountId: accountIds.dados })
      expect(finished?.payload).toMatchObject({ dataset: "groups", result: "OK", rows: 1 })
      expect(finished?.payload.bytes).toEqual(expect.any(Number))
      expect(finished?.payload.durationMs).toEqual(expect.any(Number))
    })
  })

  describe("auditoria e erros", () => {
    it("consulta registra quem, escopo, conjunto, operação, duração, quantidade e resultado, sem valor nenhum", async () => {
      const response = await dados.post(`${API}/query`).send({ dataset: "interactions", columns: ["protocol", "operator_matricula"], search: SECRET_VALUE, filter: where(condition("reason", "EQ", { value: SECRET_VALUE })) })
      expect(response.status).toBe(200)
      const audit = await lastAudit("DATA_HUB_EXPLORER_QUERY", ids.dados!)
      expect(audit).toMatchObject({ entity_type: "data_explorer", actor_id: ids.dados })
      expect(audit?.payload).toMatchObject({ dataset: "interactions", result: "OK", rows: 0, hasMore: false, scope: "ORGANIZATION", accountId: accountIds.dados, columns: ["protocol", "operator_matricula"], personalColumns: ["operator_matricula"], filterColumns: ["reason"], filterConditions: 1, searched: true, sort: "started_at:DESC" })
      expect(audit?.payload.durationMs).toEqual(expect.any(Number))
      expect(await everyAuditText()).not.toContain(SECRET_VALUE)
    })

    it("o `x-request-id` vem do cliente e nunca chega à auditoria", async () => {
      const FORGED = "CPF-123.456.789-00"
      await dados.post(`${API}/query`).set("x-request-id", FORGED).send({ dataset: "groups" })
      await dados.post(`${API}/query`).set("x-request-id", FORGED).send({ dataset: "tabela_inventada_77" })
      await (await login(app, "qa")).get(`${API}/datasets`).set("x-request-id", FORGED)
      expect(await everyAuditText()).not.toContain(FORGED)
    })

    it("tentativas negadas em laço: uma linha por conta a cada janela", async () => {
      const agent = await login(app, "gestor")
      await pool.query(`delete from audit_logs where organization_id = $1 and action = 'DATA_HUB_EXPLORER_DENIED' and actor_id = $2`, [ORG_A, ids.gestor])
      for (let attempt = 0; attempt < 5; attempt += 1) expect((await agent.get(`${API}/qualquer-coisa-${attempt}`)).status).toBe(403)
      const rows = await pool.query(`select 1 from audit_logs where organization_id = $1 and action = 'DATA_HUB_EXPLORER_DENIED' and actor_id = $2`, [ORG_A, ids.gestor])
      expect(rows.rowCount).toBe(1)
    })

    it("posição forjada é erro do pedido, sem virar falha do sistema nem linha de erro", async () => {
      const first = await geral.post(`${API}/query`).send({ dataset: "interactions", pageSize: 1 })
      const decoded = JSON.parse(Buffer.from(first.body.data.nextCursor, "base64url").toString()) as { f: string; s: string; k: string }
      for (const tampered of [{ ...decoded, s: "2026-99-99 99:99:99+00" }, { ...decoded, s: "2026-02-30 12:00:00+00" }]) {
        const response = await geral.post(`${API}/query`).send({ dataset: "interactions", cursor: Buffer.from(JSON.stringify(tampered)).toString("base64url") })
        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe("DATA_EXPLORER_INVALID_CURSOR")
      }
    })

    it("recusa registra o motivo, mas não o texto inventado", async () => {
      const INVENTED = "tabela_inventada_12345"
      await dados.post(`${API}/query`).send({ dataset: INVENTED })
      await dados.post(`${API}/query`).send({ dataset: "interactions", columns: [INVENTED] })
      const audit = await lastAudit("DATA_HUB_EXPLORER_QUERY", ids.dados!)
      expect(audit?.payload).toMatchObject({ result: "REJECTED", errorCode: "DATA_EXPLORER_COLUMN_NOT_ALLOWED", dataset: "interactions" })
      expect(await everyAuditText()).not.toContain(INVENTED)
    })

    it("sem registro na auditoria, sem dado", async () => {
      const failingAudit = {
        connect: () => pool.connect(),
        query: (sql: string, params?: unknown[]) => (typeof sql === "string" && sql.includes("insert into audit_logs") ? Promise.reject(new Error("audit_logs fora do ar")) : pool.query(sql, params as never)),
      } as unknown as Database
      const broken = createApp(failingAudit, { rateLimits: false })
      const agent = request.agent(broken)
      await agent.post("/api/v1/auth/login").send({ email: "dados@prova-consulta.inia.local", password: PASSWORD })
      const query = await agent.post(`${API}/query`).send({ dataset: "interactions" })
      expect(query.status).toBe(500)
      expect(JSON.stringify(query.body)).not.toContain("A-P1")
      expect(JSON.stringify(query.body)).not.toContain("audit_logs")
      const csv = await agent.post(`${API}/export`).send({ dataset: "interactions" })
      expect(csv.status).toBe(500)
      expect(csv.text).not.toContain("A-P1")
    })

    it("falha do banco não expõe mensagem, tabela nem pilha", async () => {
      const failing = {
        query: (sql: string, params?: unknown[]) => pool.query(sql, params as never),
        connect: async () => {
          const client = await pool.connect()
          const query = client.query.bind(client)
          ;(client as unknown as { query: unknown }).query = (sql: unknown, params?: unknown) => {
            if (typeof sql === "string" && sql.includes(" from interactions t")) return Promise.reject(Object.assign(new Error(`relation "interactions" does not exist at /srv/inia/secret.ts senha=abc`), { code: "42P01", detail: "tabela interna", stack: "Error at /srv/inia" }))
            return (query as (a: unknown, b: unknown) => unknown)(sql, params)
          }
          const release = client.release.bind(client)
          ;(client as unknown as { release: unknown }).release = (destroy?: boolean) => {
            ;(client as unknown as { query: unknown }).query = query
            release(destroy)
          }
          return client
        },
      } as unknown as Database
      const broken = createApp(failing, { rateLimits: false })
      const agent = request.agent(broken)
      await agent.post("/api/v1/auth/login").send({ email: "dados@prova-consulta.inia.local", password: PASSWORD })
      const response = await agent.post(`${API}/query`).send({ dataset: "interactions" })
      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe("DATA_EXPLORER_QUERY_FAILED")
      expect(JSON.stringify(response.body)).not.toMatch(/relation|interactions|srv|senha|42P01|stack/)
    })

    it("consulta vinda de outro site, com o cookie da sessão, é recusada", async () => {
      const response = await dados.post(`${API}/query`).set("Origin", "https://site-malicioso.example").send({ dataset: "interactions" })
      expect(response.status).toBe(403)
      expect(JSON.stringify(response.body)).not.toContain("A-P1")
    })

    it("aba Registro: exportação e negação na lista padrão; consultas só filtrando por essa ação", async () => {
      await dados.post(`${API}/query`).send({ dataset: "groups" })
      await dados.post(`${API}/export`).send({ dataset: "groups" })
      const actions = (body: { data: { items: { action: string }[] } }) => new Set(body.data.items.map((item) => item.action))
      const standard = actions((await dados.get("/api/v1/admin/data-hub/audit-events?page=1&pageSize=100")).body)
      expect(standard.has("DATA_HUB_EXPLORER_EXPORT_FINISHED")).toBe(true)
      expect(standard.has("DATA_HUB_EXPLORER_DENIED")).toBe(true)
      expect(standard.has("DATA_HUB_EXPLORER_QUERY")).toBe(false)
      const filtered = actions((await dados.get("/api/v1/admin/data-hub/audit-events?page=1&pageSize=100&action=DATA_HUB_EXPLORER_QUERY")).body)
      expect([...filtered]).toEqual(["DATA_HUB_EXPLORER_QUERY"])
    })

    it("corpo malformado não vira erro interno", async () => {
      const response = await dados.post(`${API}/query`).set("content-type", "application/json").send("{nao é json")
      expect(response.status).toBe(400)
      expect(JSON.stringify(response.body)).not.toContain("stack")
    })

    it("a consulta nunca escreve em tabela de dados: só a auditoria muda", async () => {
      const counts = async () => (await pool.query<{ n: number }>(`select (select count(*) from people where organization_id = $1)::int + (select count(*) from interactions where organization_id = $1)::int + (select count(*) from indicator_measurements where organization_id = $1)::int n`, [ORG_A])).rows[0]!.n
      const before = await counts()
      await dados.post(`${API}/query`).send({ dataset: "interactions" })
      await dados.post(`${API}/count`).send({ dataset: "collaborators" })
      await dados.post(`${API}/export`).send({ dataset: "indicator_measurements" })
      expect(await counts()).toBe(before)
    })
  })

  describe("o que a tela recebe", () => {
    it("metadados com tipos, sem SQL nem nome de tabela", async () => {
      const list = await geral.get(`${API}/datasets`)
      expect(list.body.data.limits).toMatchObject({ maxPageSize: 100, defaultPageSize: 25, exportMaxRows: 20_000 })
      const detail = await geral.get(`${API}/datasets/collaborators`)
      const text = JSON.stringify(detail.body)
      expect(text).not.toMatch(/left join|\bpeople\b|t\.name|"sql"/)
      expect(detail.body.data.columns.find((column: { key: string }) => column.key === "name")).toMatchObject({ type: "TEXT", personal: true, sortable: true, searchable: true, operators: ["EQ", "NEQ", "IN"] })
    })
  })
})
