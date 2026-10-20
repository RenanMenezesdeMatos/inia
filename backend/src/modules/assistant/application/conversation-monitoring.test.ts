import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { CLARIFICATION_TOOL_NAME, KNOWLEDGE_CLARIFICATION_VERSION, optionIdFor, stepIdFor, type ClarificationState, type ClarificationStep } from "../../knowledge-clarification/domain/clarification-state.js"
import type { PresentationRow } from "../../profile-preferences/domain/person-presentation.js"
import { listMonitoredConversations, loadMonitoredMessages, OUT_OF_READER_SCOPE_NOTICE, requireMonitoredConversation } from "./conversation-monitoring.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const VIEWER = { organizationId: ORG, personId: "00000000-0000-4000-8000-0000000000aa" }
const LARISSA = "00000000-0000-4000-8000-000000000011"
const BRUNO = "00000000-0000-4000-8000-000000000012"

/** Linha da lista como o SQL devolve — com a imagem do CADASTRO do dono (`people.avatar_url`). */
function conversationRow(id: string, ownerId: string, ownerName: string, ownerAvatarUrl: string | null) {
  return {
    id,
    kind: "CONVERSATION",
    status: "ACTIVE",
    started_at: new Date("2026-10-14T12:00:00Z"),
    last_activity_at: new Date("2026-10-14T12:05:00Z"),
    closed_at: null,
    close_reason: null,
    origin: "USER",
    title: null,
    owner_seen_at: null,
    feedback_follow_up: false,
    message_count: 2,
    first_user_message: "Como faço a mudança de endereço?",
    last_role: "assistant",
    last_content: "Pelo app.",
    last_channel: "chat",
    voice_message_count: 0,
    owner_id: ownerId,
    owner_name: ownerName,
    owner_job_title: "Operador",
    owner_avatar_url: ownerAvatarUrl,
    team_name: "ATENDIMENTO",
    subteam_name: null,
  }
}

/** Apresentação no banco: Larissa escolheu foto no perfil; Bruno só tem a imagem corporativa. */
const PRESENTATIONS: PresentationRow[] = [
  { person_id: LARISSA, registered_name: "Larissa Operadora", corporate_avatar_url: "https://cdn.cliente/larissa.jpg", preferred_name: null, avatar_image_id: "img-larissa", cover_kind: null, cover_preset: null, cover_image_id: null },
  { person_id: BRUNO, registered_name: "Bruno Operador", corporate_avatar_url: "https://cdn.cliente/bruno.jpg", preferred_name: null, avatar_image_id: null, cover_kind: null, cover_preset: null, cover_image_id: null },
]

/** Banco falso: responde cada consulta pelo que ela é e guarda os parâmetros da leitura de apresentação. */
function fakeDb(rows: ReturnType<typeof conversationRow>[]) {
  const presentationCalls: unknown[][] = []
  const db = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("person_profile_preferences")) {
        presentationCalls.push(params)
        const ids = params[1] as string[]
        return { rows: PRESENTATIONS.filter((row) => params[0] === ORG && ids.includes(row.person_id)) }
      }
      if (sql.includes("count(*)::int n")) return { rows: [{ n: rows.length }] }
      if (sql.includes("from people owner")) return { rows: [] }
      return { rows }
    },
  } as unknown as Database
  return { db, presentationCalls }
}

describe("monitoramento de conversas — foto do dono pela apresentação", () => {
  it("lista: a foto do perfil vence a do cadastro, sem foto escolhida fica a corporativa, e é UMA leitura em lote para a página", async () => {
    const { db, presentationCalls } = fakeDb([
      conversationRow("c-1", LARISSA, "Larissa Operadora", "https://cdn.cliente/larissa.jpg"),
      conversationRow("c-2", BRUNO, "Bruno Operador", "https://cdn.cliente/bruno.jpg"),
      conversationRow("c-3", LARISSA, "Larissa Operadora", "https://cdn.cliente/larissa.jpg"),
    ])
    const result = await listMonitoredConversations(db, VIEWER, { page: 1, pageSize: 20 })
    expect(result.items.map((conversation) => [conversation.id, conversation.owner.avatarUrl])).toEqual([
      ["c-1", "/api/v1/profile-images/img-larissa"],
      ["c-2", "https://cdn.cliente/bruno.jpg"],
      ["c-3", "/api/v1/profile-images/img-larissa"],
    ])
    expect(presentationCalls).toEqual([[ORG, [LARISSA, BRUNO]]])
  })

  it("leitura de uma conversa: o dono vem com a foto do perfil", async () => {
    const { db, presentationCalls } = fakeDb([conversationRow("c-1", LARISSA, "Larissa Operadora", "https://cdn.cliente/larissa.jpg")])
    const conversation = await requireMonitoredConversation(db, VIEWER, "00000000-0000-4000-8000-0000000000c1")
    expect(conversation.owner).toMatchObject({ personId: LARISSA, avatarUrl: "/api/v1/profile-images/img-larissa" })
    expect(presentationCalls).toHaveLength(1)
  })

  it("página vazia: nenhuma leitura de foto", async () => {
    const { db, presentationCalls } = fakeDb([])
    expect((await listMonitoredConversations(db, VIEWER, { page: 1, pageSize: 20 })).items).toEqual([])
    expect(presentationCalls).toEqual([])
  })
})

describe("monitoramento de conversas — dados da liderança só no escopo de quem LÊ (auditoria 17/10/2026, SCOPE-01)", () => {
  const MANAGER = "00000000-0000-4000-8000-000000000021"
  const ownCard = { type: "SELF_RESULTS", id: "c-own", structure: { subject: { kind: "EMPLOYEE", employeeId: MANAGER } } }
  const groupA = { type: "QUERY_TABLE", id: "c-a", structure: { subject: { kind: "TEAM", teamId: "team-a" } } }
  const groupB = { type: "QUERY_TABLE", id: "c-b", structure: { subject: { kind: "TEAM", teamId: "team-b" } } }
  const message = (id: string, content: string, analytics: unknown[], seq: number) => ({ id, channel: "chat", role: "assistant", content, agent_id: null, occurred_at: new Date(`2026-10-14T12:0${seq}:00Z`), seq: String(seq), client_message_id: null, tool_calls: analytics.map((card) => ({ toolName: "leadership_indicator_query", analytics: card })) })
  const db = {
    query: async (sql: string) => {
      if (sql.includes("seq::text seq, client_message_id, tool_calls")) {
        return { rows: [message("m1", "Seus resultados: TMA 310 s.", [ownCard], 1), message("m2", "Grupo A: Ana 92%.", [groupA], 2), message("m3", "Grupo B: Bia 61%, afastada.", [groupA, groupB], 3), message("m4", "Olá!", [], 4)] }
      }
      if (sql.includes("person_profile_preferences") || sql.includes("support_materials")) return { rows: [] }
      return { rows: [conversationRow("conv-1", MANAGER, "Marta Gerente", null)] }
    },
  } as unknown as Database
  // Leitor com dados só do Grupo A: o filtro devolve os cartões dele (o do dono entra pelo router, aqui simulado).
  const readerOfGroupA = async ({ cards }: { ownerPersonId: string; cards: unknown[] }) => cards.filter((card) => card === groupA || card === ownCard)

  it("resposta com cartão fora do escopo do leitor sai sem texto e sem cartões; as demais seguem iguais", async () => {
    const result = await loadMonitoredMessages(db, VIEWER, "conv-1", { limit: 30 }, readerOfGroupA)
    const byId = new Map(result.messages.map((entry) => [entry.id, entry]))
    expect(byId.get("m1")).toMatchObject({ content: "Seus resultados: TMA 310 s.", analytics: [ownCard] })
    expect(byId.get("m2")).toMatchObject({ content: "Grupo A: Ana 92%.", analytics: [groupA] })
    expect(byId.get("m3")).toMatchObject({ content: OUT_OF_READER_SCOPE_NOTICE, analytics: [], outOfReaderScope: true })
    expect(byId.get("m4")).toMatchObject({ content: "Olá!" })
    expect(JSON.stringify(result)).not.toContain("Bia")
  })

  it("sem filtro do leitor, nenhuma resposta com cartão de dados aparece (falha fechada)", async () => {
    const result = await loadMonitoredMessages(db, VIEWER, "conv-1", { limit: 30 })
    expect(result.messages.filter((entry) => "outOfReaderScope" in entry).map((entry) => entry.id).sort()).toEqual(["m1", "m2", "m3"])
  })
})

describe("monitoramento de conversas — trilha do esclarecimento pelas bases (auditoria; 20/10/2026)", () => {
  const OWNER = "00000000-0000-4000-8000-000000000031"
  const READABLE = "00000000-0000-4000-8000-0000000000b1"
  const RESTRICTED = "00000000-0000-4000-8000-0000000000b2"
  const ref = (documentId: string, documentTitle: string, heading: string, chunkIndex: number) => ({ documentId, documentTitle, versionId: `${documentId.slice(-2)}-v1`, heading, chunkIndex })
  const dimension = "Tipo de cliente"
  const step: ClarificationStep = {
    id: stepIdFor(1, dimension),
    dimension,
    question: "A troca é de cliente empresa ou residencial?",
    selectionMode: "SINGLE",
    options: [
      { id: optionIdFor(dimension, "Empresa"), label: "Empresa", description: null, group: null, evidence: [ref(READABLE, "Troca de titularidade — Empresa", "2. Tipos", 1)] },
      { id: optionIdFor(dimension, "Residencial"), label: "Residencial", description: null, group: null, evidence: [ref(RESTRICTED, "Base restrita da diretoria", "1. Residencial", 0)] },
    ],
    answer: null,
  }
  const base: ClarificationState = { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "22222222-2222-4222-8222-222222222222", originalQuestion: "Quais documentos para a troca de titularidade?", status: "OPEN", steps: [step], questionFacts: [], coverage: { consideredDocuments: 9, matchedDocuments: 2, presentedDocuments: 9, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: "2026-10-20T12:00:00.000Z" }
  const answered: ClarificationState = { ...base, status: "ANSWERED", steps: [{ ...step, answer: { optionIds: [step.options[0]!.id], freeText: null, noneMatched: false, via: "FORM", answeredAt: "2026-10-20T12:01:00.000Z" } }], sources: [ref(READABLE, "Troca de titularidade — Empresa", "3. PJ → PJ", 2)] }
  const row = (id: string, role: "user" | "assistant", content: string, seq: number, toolCalls: unknown[] = []) => ({ id, channel: "voice", role, content, agent_id: null, occurred_at: new Date(`2026-10-20T12:0${seq}:00Z`), seq: String(seq), client_message_id: null, tool_calls: toolCalls })
  const entry = (state: ClarificationState) => ({ toolName: CLARIFICATION_TOOL_NAME, state, scope: { kind: "LEADERSHIP", marker: "escopo-interno-do-servidor" } })
  const accessQueries: unknown[][] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("seq::text seq, client_message_id, tool_calls")) {
        return { rows: [row("u1", "user", "Quais documentos para a troca de titularidade?", 1), row("a1", "assistant", "A troca é de cliente empresa ou residencial?", 2, [entry(base)]), row("a2", "assistant", "Para PJ → PJ, peça o contrato social [1].", 3, [entry(answered)])] }
      }
      // Acesso às bases citadas, para QUEM LÊ: só a base de procedimento comum é alcançável.
      if (sql.includes("from knowledge_documents d")) {
        accessQueries.push(params)
        return { rows: [{ id: READABLE, title: "Troca de titularidade — Empresa", documentType: "PROCEDURE", sourceType: "TEXT" }] }
      }
      if (sql.includes("from assistant_conversations")) return { rows: [conversationRow("conv-9", OWNER, "Mariana Operadora", null)] }
      return { rows: [] }
    },
  } as unknown as Database

  it("cada resposta traz a trilha: opções com a base que sustenta cada uma, fontes e cobertura; base que o LEITOR não alcança vai sem título; o escopo interno nunca sai", async () => {
    const result = await loadMonitoredMessages(db, VIEWER, "conv-9", { limit: 30 })
    const byId = new Map(result.messages.map((message) => [message.id, message]))
    expect(byId.get("u1")!.clarification).toBeNull()
    const open = byId.get("a1")!.clarification!
    expect(open).toMatchObject({ status: "OPEN", originalQuestion: "Quais documentos para a troca de titularidade?", coverage: { consideredDocuments: 9, presentedDocuments: 9 } })
    expect(open.steps[0]!.options.map((option) => option.evidence[0])).toEqual([
      { ...ref(READABLE, "Troca de titularidade — Empresa", "2. Tipos", 1), available: true },
      { ...ref(RESTRICTED, "", "", 0), available: false },
    ])
    expect(byId.get("a2")!.clarification).toMatchObject({ status: "ANSWERED", sources: [{ documentId: READABLE, heading: "3. PJ → PJ", available: true }], scenario: [{ dimension, value: "Empresa", origin: "SELECTION" }] })
    // O texto gravado mantém os marcadores [n] — a auditoria numera as fontes do mesmo jeito.
    expect(byId.get("a2")!.content).toContain("[1]")
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("Base restrita da diretoria")
    expect(serialized).not.toContain("escopo-interno-do-servidor")
    expect(serialized).not.toContain("clarificationScope")
    // Uma leitura de acesso para a página, com as duas bases citadas, como QUEM LÊ (não como o dono da conversa).
    expect(accessQueries).toHaveLength(1)
    expect(accessQueries[0]!.slice(0, 2)).toEqual([ORG, VIEWER.personId])
    expect(new Set(accessQueries[0]!.find((param) => Array.isArray(param) && param.includes(READABLE)) as string[])).toEqual(new Set([READABLE, RESTRICTED]))
  })
})
