import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { transcriptChecksum } from "../../workflows/application/transcript.js"
import type { QaWorkflowRow } from "./build-simulated-enrollment.js"
import { findCompatibleInteractions, getInteractionDetail, graphNeedsTranscript, resolveEligibleOperatorIds, resolveInteractionEvidence } from "./interaction-evidence.js"
import { listPeople } from "./test-data-finders.js"

/** Organização da sessão de quem testa no QA Lab. */
const QA_ORGANIZATION = "00000000-0000-4000-8000-000000000001"

/**
 * Massa de teste por interação (Parte 58/59): busca colaborador-first, compatibilidade com o
 * gatilho, Abrangência/Filtro Populacional, período, paginação, detalhe com transcrição e a
 * validação que o backend faz ANTES de executar (nunca confia na lista do frontend).
 * Banco fake em memória com filtros reais (flag/operador/período/offset) — zero IA.
 */
const WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const FLAG_RECHAMADA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const FLAG_NOTA_URA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2"
const MARIA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
const PEDRO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"
const TEAM_FATURAS = "11111111-1111-4111-8111-111111111111"
const TEAM_VENDAS = "11111111-1111-4111-8111-111111111112"
const TRANSCRIPT = "Operador: Bom dia, em que posso ajudar?\nCliente: Eu estou ligando novamente porque..."

type Interaction = { id: string; external_id: string; operator_id: string; channel: string; reason: string; started_at: string; ended_at: string }
type Flag = { interaction_id: string; channel_flag_id: string; value_boolean: boolean | null; value_numeric: string | null }

const people = [
  { id: MARIA, name: "Maria Oliveira", role: "OPERATOR", team_id: TEAM_FATURAS, team_name: "FATURAS", subteam_id: null, subteam_name: null, active: true },
  { id: PEDRO, name: "Pedro Lima", role: "OPERATOR", team_id: TEAM_VENDAS, team_name: "VENDAS", subteam_id: null, subteam_name: null, active: true },
]
const channelFlags = [
  { id: FLAG_RECHAMADA, channel: "VOICE", flag_name: "rechamada", value_type: "BOOLEAN" },
  { id: FLAG_NOTA_URA, channel: "VOICE", flag_name: "nota_ura", value_type: "NUMERIC" },
]

function interactionId(n: number): string {
  return `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(n).padStart(2, "0")}`
}

function interaction(n: number, operatorId: string, startedAt: string, extra: Partial<Interaction> = {}): Interaction {
  return { id: interactionId(n), external_id: `PROTO-${n}`, operator_id: operatorId, channel: "VOICE", reason: "Cobrança", started_at: startedAt, ended_at: new Date(new Date(startedAt).getTime() + 438_000).toISOString(), ...extra }
}

function fakeDatabase(data: { interactions: Interaction[]; flags: Flag[]; transcripts: Record<string, string>; workflow?: Partial<QaWorkflowRow> }) {
  const log: string[] = []
  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim()
    log.push(text)
    if (text.includes("from workflows w where w.id = $1")) {
      return {
        rows: [{ id: WORKFLOW_ID, name: "Feedback Rechamada", scope_type: "ALL_TEAMS", team_id: null, subteam_id: null, trigger_config: { kind: "channel_flag", channelFlagId: FLAG_RECHAMADA }, consolidated_structure: null, population_filter: null, active_version_id: null, draft_graph: { nodes: [], edges: [] }, published_graph: null, ...data.workflow }],
        rowCount: 1,
      }
    }
    if (text.includes("select id, channel, flag_name, value_type from channel_flags where id = $1")) {
      return { rows: channelFlags.filter((flag) => flag.id === params[0]), rowCount: 1 }
    }
    // Elegibilidade compartilhada (workflow-eligibility.ts) — conjunto da Abrangência e decisão pontual.
    if (text.includes("select id from people where organization_id = $1 and role = 'OPERATOR' and active")) {
      const rows = people
        .filter((person) => params[1] === "ALL_TEAMS" || (params[1] === "TEAM" && person.team_id === params[2]) || (params[1] === "SUBTEAM" && person.subteam_id === params[3]))
        .map((person) => ({ id: person.id }))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("select id, team_id, subteam_id, reports_to_id from people where id = $1")) {
      const rows = people.filter((person) => person.id === params[0]).map((person) => ({ id: person.id, team_id: person.team_id, subteam_id: person.subteam_id, reports_to_id: null }))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("select id from people where subteam_id = $1 and role = 'OPERATOR'")) return { rows: [], rowCount: 0 }
    // Lista de interações (findInteractions) — aplica flag/operador/período/busca/limit/offset de verdade.
    if (text.includes("from interaction_flags f join interactions i on i.id = f.interaction_id")) {
      const [, flagId, ...rest] = params as [string, string, ...unknown[]]
      const conditions: ((row: Interaction) => boolean)[] = []
      let cursor = 0
      if (text.includes("i.operator_id = $")) {
        const operatorId = rest[cursor++] as string
        conditions.push((row) => row.operator_id === operatorId)
      }
      if (text.includes("i.started_at >= $")) {
        const from = rest[cursor++] as string
        conditions.push((row) => row.started_at >= from)
      }
      if (text.includes("i.started_at < $")) {
        const to = rest[cursor++] as string
        conditions.push((row) => row.started_at < to)
      }
      if (text.includes("i.external_id ilike $")) {
        const pattern = (rest[cursor++] as string).replace(/%/g, "").toLowerCase()
        conditions.push((row) => row.external_id.toLowerCase().includes(pattern))
      }
      const limit = rest[cursor++] as number
      const offset = rest[cursor++] as number
      const rows = data.flags
        .filter((flag) => flag.channel_flag_id === flagId)
        .map((flag) => ({ flag, row: data.interactions.find((item) => item.id === flag.interaction_id)! }))
        .filter(({ row }) => row && conditions.every((condition) => condition(row)))
        .sort((a, b) => (a.row.started_at < b.row.started_at ? 1 : -1))
        .slice(offset, offset + limit)
        .map(({ flag, row }) => {
          const person = people.find((item) => item.id === row.operator_id)!
          const catalog = channelFlags.find((item) => item.id === flag.channel_flag_id)!
          return { ...row, operator_name: person.name, team_name: person.team_name, flag_name: catalog.flag_name, value_boolean: flag.value_boolean, value_numeric: flag.value_numeric, has_transcript: Boolean(data.transcripts[row.id]) }
        })
      return { rows, rowCount: rows.length }
    }
    if (text.includes("from interactions i join people p on p.id = i.operator_id left join teams t") && text.includes("where i.id = $1 and i.organization_id")) {
      const row = data.interactions.find((item) => item.id === params[0])
      if (!row) return { rows: [], rowCount: 0 }
      const person = people.find((item) => item.id === row.operator_id)!
      return { rows: [{ ...row, operator_name: person.name, team_id: person.team_id, team_name: person.team_name }], rowCount: 1 }
    }
    if (text.includes("select f.value_boolean, f.value_numeric from interaction_flags f where f.interaction_id = $1 and f.channel_flag_id = $2")) {
      const rows = data.flags.filter((flag) => flag.interaction_id === params[0] && flag.channel_flag_id === params[1])
      return { rows, rowCount: rows.length }
    }
    if (text.includes("select f.channel_flag_id, cf.flag_name, cf.value_type, f.value_boolean, f.value_numeric, f.received_at")) {
      const rows = data.flags
        .filter((flag) => flag.interaction_id === params[0])
        .map((flag) => ({ ...flag, ...channelFlags.find((item) => item.id === flag.channel_flag_id)!, received_at: "2026-09-12T17:50:00.000Z" }))
      return { rows, rowCount: rows.length }
    }
    if (text.includes("from transcripts where interaction_id = $1")) {
      const content = data.transcripts[params[0] as string]
      return content ? { rows: [{ content, version: 1, language: "pt-BR", confidence: "0.91" }], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (text.includes("from people p left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id where")) {
      const eligible = text.includes("p.id = any($") ? (params[2] as string[]) : null
      const rows = people.filter((person) => !eligible || eligible.includes(person.id)).map((person) => ({ ...person, has_shift: false }))
      return { rows, rowCount: rows.length }
    }
    return { rows: [], rowCount: 0 }
  }
  return { db: { query } as unknown as Database, log }
}

const sample = {
  interactions: [
    interaction(1, MARIA, "2026-09-12T17:42:00.000Z"),
    interaction(2, MARIA, "2026-09-11T12:15:00.000Z"),
    interaction(3, MARIA, "2026-09-10T19:31:00.000Z"),
    interaction(4, MARIA, "2026-08-01T10:00:00.000Z"), // fora dos últimos 30 dias (relativo a 12/09)
    interaction(5, MARIA, "2026-09-12T09:00:00.000Z"), // só nota_ura — sem rechamada
    interaction(6, PEDRO, "2026-09-12T11:00:00.000Z"),
    interaction(7, MARIA, "2026-09-12T08:00:00.000Z", { channel: "CHAT" }),
  ],
  flags: [
    { interaction_id: interactionId(1), channel_flag_id: FLAG_RECHAMADA, value_boolean: true, value_numeric: null },
    { interaction_id: interactionId(2), channel_flag_id: FLAG_RECHAMADA, value_boolean: true, value_numeric: null },
    { interaction_id: interactionId(3), channel_flag_id: FLAG_RECHAMADA, value_boolean: false, value_numeric: null },
    { interaction_id: interactionId(4), channel_flag_id: FLAG_RECHAMADA, value_boolean: true, value_numeric: null },
    { interaction_id: interactionId(5), channel_flag_id: FLAG_NOTA_URA, value_boolean: null, value_numeric: "2" },
    { interaction_id: interactionId(6), channel_flag_id: FLAG_RECHAMADA, value_boolean: true, value_numeric: null },
    { interaction_id: interactionId(7), channel_flag_id: FLAG_RECHAMADA, value_boolean: true, value_numeric: null },
  ],
  transcripts: { [interactionId(1)]: TRANSCRIPT, [interactionId(2)]: TRANSCRIPT },
}

async function workflowRow(db: Database): Promise<QaWorkflowRow> {
  const { loadWorkflowForSimulation } = await import("./build-simulated-enrollment.js")
  return (await loadWorkflowForSimulation(db, QA_ORGANIZATION, WORKFLOW_ID))!
}

describe("QA Lab — interações compatíveis com o gatilho (colaborador-first)", () => {
  it("colaborador com interações compatíveis: só as que têm a flag do gatilho, mais recentes primeiro, com duração e transcrição", async () => {
    const { db } = fakeDatabase(sample)
    const result = await findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, limit: 20, offset: 0 })
    expect(result.flag).toMatchObject({ label: "VOICE.rechamada", valueType: "BOOLEAN" })
    // PROTO-5 (só nota_ura) nunca aparece; PROTO-7 é CHAT mas tem a flag (a lista é por flag —
    // o canal é validado na execução, ver abaixo).
    expect(result.rows.map((row) => row.externalId)).toEqual(["PROTO-1", "PROTO-7", "PROTO-2", "PROTO-3", "PROTO-4"])
    expect(result.rows[0]).toMatchObject({ durationSeconds: 438, hasTranscript: true, value: true, channel: "VOICE" })
    expect(result.rows[3]).toMatchObject({ externalId: "PROTO-3", hasTranscript: false, value: false })
    expect(result.hasMore).toBe(false)
  })

  it("colaborador sem interação compatível: lista vazia (nunca inventa massa)", async () => {
    const { db } = fakeDatabase({ ...sample, flags: sample.flags.filter((flag) => flag.channel_flag_id !== FLAG_RECHAMADA) })
    const result = await findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, limit: 20, offset: 0 })
    expect(result.rows).toEqual([])
  })

  it("filtro de período: 'últimos 30 dias' exclui a interação de agosto", async () => {
    const { db } = fakeDatabase(sample)
    const result = await findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, from: "2026-08-13T00:00:00.000Z", to: "2026-09-13T00:00:00.000Z", limit: 20, offset: 0 })
    expect(result.rows.map((row) => row.externalId)).not.toContain("PROTO-4")
    expect(result.rows).toHaveLength(4)
  })

  it("busca por identificador externo/protocolo", async () => {
    const { db } = fakeDatabase(sample)
    const result = await findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, search: "proto-2", limit: 20, offset: 0 })
    expect(result.rows.map((row) => row.externalId)).toEqual(["PROTO-2"])
  })

  it("paginação: limit + offset, hasMore só enquanto restam interações", async () => {
    const { db } = fakeDatabase(sample)
    const first = await findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, limit: 2, offset: 0 })
    expect(first.rows.map((row) => row.externalId)).toEqual(["PROTO-1", "PROTO-7"])
    expect(first.hasMore).toBe(true)
    const last = await findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, limit: 2, offset: 4 })
    expect(last.rows.map((row) => row.externalId)).toEqual(["PROTO-4"])
    expect(last.hasMore).toBe(false)
  })

  it("cenário 'Atende / Não atende' usa o mesmo comparador do motor", async () => {
    const { db } = fakeDatabase(sample)
    const notMatching = await findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, comparator: "EQUALS", thresholdBoolean: true, negate: true, limit: 20, offset: 0 })
    expect(notMatching.rows.map((row) => row.externalId)).toEqual(["PROTO-3"])
  })

  it("Abrangência: colaborador de outro grupo é rejeitado com mensagem amigável", async () => {
    const { db } = fakeDatabase({ ...sample, workflow: { scope_type: "TEAM", team_id: TEAM_FATURAS } })
    await expect(findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: PEDRO, limit: 20, offset: 0 })).rejects.toMatchObject({
      code: "QA_OPERATOR_OUT_OF_POPULATION",
      message: "O colaborador não pertence à população deste Workflow (Abrangência/Filtro Populacional).",
    })
  })

  it("Filtro Populacional (EMPLOYEE): só o colaborador configurado é elegível, e o seletor de pessoas respeita isso", async () => {
    const { db } = fakeDatabase({ ...sample, workflow: { population_filter: { kind: "EMPLOYEE", employeeId: MARIA } } })
    const row = await workflowRow(db)
    expect(await resolveEligibleOperatorIds(db, QA_ORGANIZATION, row)).toEqual([MARIA])
    await expect(findCompatibleInteractions(db, QA_ORGANIZATION, row, { operatorId: PEDRO, limit: 20, offset: 0 })).rejects.toMatchObject({ code: "QA_OPERATOR_OUT_OF_POPULATION" })
    const options = await listPeople(db, QA_ORGANIZATION, { workflowId: WORKFLOW_ID, limit: 100 })
    expect(options.map((person) => person.name)).toEqual(["Maria Oliveira"])
  })

  it("workflow que não dispara por Flag: erro claro", async () => {
    const { db } = fakeDatabase({ ...sample, workflow: { trigger_config: { kind: "indicator", indicatorCode: "QUALIDADE" } } })
    await expect(findCompatibleInteractions(db, QA_ORGANIZATION, await workflowRow(db), { operatorId: MARIA, limit: 20, offset: 0 })).rejects.toMatchObject({ code: "QA_TRIGGER_NOT_FLAG" })
  })
})

describe("QA Lab — detalhe da interação e transcrição (só leitura)", () => {
  it("transcrição disponível: texto puro persistido + versão + checksum; flags com valores", async () => {
    const { db, log } = fakeDatabase(sample)
    const detail = await getInteractionDetail(db, QA_ORGANIZATION, interactionId(1))
    expect(detail).toMatchObject({ externalId: "PROTO-1", operatorName: "Maria Oliveira", channel: "VOICE", durationSeconds: 438 })
    expect(detail!.flags).toEqual([{ channelFlagId: FLAG_RECHAMADA, name: "rechamada", valueType: "BOOLEAN", value: true, receivedAt: "2026-09-12T17:50:00.000Z" }])
    expect(detail!.transcript).toEqual({ content: TRANSCRIPT, version: 1, language: "pt-BR", confidence: 0.91, checksum: transcriptChecksum(TRANSCRIPT) })
    // Nenhuma chamada a modelo e nenhuma escrita — só selects.
    expect(log.every((sql) => sql.startsWith("select"))).toBe(true)
  })

  it("transcrição ausente: null explícito (a UI diz 'não disponível', nunca gera uma)", async () => {
    const { db } = fakeDatabase(sample)
    const detail = await getInteractionDetail(db, QA_ORGANIZATION, interactionId(3))
    expect(detail!.transcript).toBeNull()
  })

  it("interação inexistente: null (404 na rota)", async () => {
    const { db } = fakeDatabase(sample)
    expect(await getInteractionDetail(db, QA_ORGANIZATION, "dddddddd-dddd-4ddd-8ddd-dddddddddd99")).toBeNull()
  })
})

describe("QA Lab — validação da interação antes de executar (backend, nunca só o frontend)", () => {
  it("interação sem a flag do gatilho é rejeitada: 'não possui a Flag VOICE.rechamada'", async () => {
    const { db } = fakeDatabase(sample)
    await expect(resolveInteractionEvidence(db, QA_ORGANIZATION, await workflowRow(db), interactionId(5))).rejects.toMatchObject({
      code: "QA_FLAG_MISSING_ON_INTERACTION",
      message: "Esta interação não possui a Flag VOICE.rechamada exigida pelo gatilho.",
    })
  })

  it("canal diferente do canal da flag é rejeitado", async () => {
    const { db } = fakeDatabase(sample)
    await expect(resolveInteractionEvidence(db, QA_ORGANIZATION, await workflowRow(db), interactionId(7))).rejects.toMatchObject({ code: "QA_CHANNEL_MISMATCH" })
  })

  it("interação de colaborador fora da população do Workflow é rejeitada mesmo tendo a flag", async () => {
    const { db } = fakeDatabase({ ...sample, workflow: { scope_type: "TEAM", team_id: TEAM_FATURAS } })
    await expect(resolveInteractionEvidence(db, QA_ORGANIZATION, await workflowRow(db), interactionId(6))).rejects.toMatchObject({ code: "QA_OPERATOR_OUT_OF_POPULATION" })
  })

  it("interação compatível: evidência com identidade, flag, duração e checksum da transcrição — sem copiar a transcrição pra evidência", async () => {
    const { db } = fakeDatabase(sample)
    const resolved = await resolveInteractionEvidence(db, QA_ORGANIZATION, await workflowRow(db), interactionId(1))
    expect(resolved.evidence).toMatchObject({
      externalId: "PROTO-1",
      operatorId: MARIA,
      operatorName: "Maria Oliveira",
      channel: "VOICE",
      durationSeconds: 438,
      flag: { name: "rechamada", value: true },
      transcript: { available: true, version: 1, checksum: transcriptChecksum(TRANSCRIPT), length: TRANSCRIPT.length },
    })
    expect(JSON.stringify(resolved.evidence)).not.toContain("Bom dia, em que posso ajudar")
    expect(resolved.inputContext).toBe(TRANSCRIPT)
    expect(resolved.matched).toEqual({ flagName: "rechamada", valueBoolean: true, valueNumeric: null })
    expect(resolved.transcriptChangedSinceOriginalRun).toBe(false)
  })

  it("reexecução: interação removida → 'não está mais disponível' (nunca escolhe outra)", async () => {
    const { db } = fakeDatabase({ ...sample, interactions: sample.interactions.filter((row) => row.external_id !== "PROTO-1") })
    const frozen = { evidence: { interactionId: interactionId(1), transcript: { available: true, checksum: "abc", version: 1, length: 1, language: "pt-BR", confidence: null } } as never, inputContext: TRANSCRIPT }
    await expect(resolveInteractionEvidence(db, QA_ORGANIZATION, await workflowRow(db), interactionId(1), frozen)).rejects.toMatchObject({
      code: "QA_INTERACTION_UNAVAILABLE",
      message: "A interação original deste QA Run não está mais disponível.",
    })
  })

  it("reexecução: transcrição alterada desde o QA Run original → usa a congelada e registra a divergência", async () => {
    const { db } = fakeDatabase({ ...sample, transcripts: { ...sample.transcripts, [interactionId(1)]: "Operador: texto reprocessado." } })
    const original = await resolveInteractionEvidence(fakeDatabase(sample).db, QA_ORGANIZATION, await workflowRow(db), interactionId(1))
    const rerun = await resolveInteractionEvidence(db, QA_ORGANIZATION, await workflowRow(db), interactionId(1), { evidence: original.evidence, inputContext: original.inputContext })
    expect(rerun.transcriptChangedSinceOriginalRun).toBe(true)
    expect(rerun.inputContext).toBe(TRANSCRIPT)
    expect(rerun.evidence.transcript.checksum).toBe(transcriptChecksum(TRANSCRIPT))
  })

  it("graphNeedsTranscript: só Actions 'Chamar Agent' ou node Orchestrator exigem transcrição", () => {
    const trigger = { id: "t", type: "trigger" as const, label: "Gatilho", position: { x: 0, y: 0 }, config: {} }
    expect(graphNeedsTranscript({ nodes: [trigger], edges: [] })).toBe(false)
    expect(graphNeedsTranscript({ nodes: [trigger, { id: "a", type: "action", label: "Agent", position: { x: 0, y: 0 }, config: { actionType: "CALL_AGENT", agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }], edges: [] })).toBe(true)
  })
})
