import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { PresentationRow } from "../../profile-preferences/domain/person-presentation.js"
import { listMonitoredConversations, requireMonitoredConversation } from "./conversation-monitoring.js"

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
