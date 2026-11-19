import { describe, expect, it } from "vitest"
import type { FollowUpFeedQuery } from "../application/analytics-read-repository.js"
import { FOLLOW_UP_TYPES, type FollowUpItem, type FollowUpType } from "../domain/view-models.js"
import { followUpTypeOf, InMemoryAnalyticsRepository, ORG } from "./in-memory-analytics-repository.js"

/**
 * ARQ-16 / QA-11 — filtros do Acompanhamento da estrutura ("Tipo" e ciência) na suíte normal: o dublê em memória aplica as MESMAS
 * regras do Postgres (`followUpTypeSql`, `unacknowledgedOnly`), então um teste de rota com `types=` não passa mais sem filtrar. O
 * comportamento contra o banco continua em `follow-up-feed-proof`.
 */
const LEADER = "leader"
let minute = 0
const item = (id: string, kind: FollowUpItem["kind"], category: FollowUpItem["category"], extra: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id,
  kind,
  category,
  title: id,
  summary: "",
  detail: null,
  severity: null,
  operator: kind === "FEEDBACK" ? { personId: "op-1", name: "Operadora" } : null,
  caseId: null,
  createdAt: new Date(Date.UTC(2026, 10, 19, 12, minute++)).toISOString(),
  acknowledgedAt: null,
  feedback: null,
  ...extra,
})

const notice = (authorId: string) => ({ notice: { author: { personId: authorId } } as never })
const FEED: FollowUpItem[] = [
  item("monitoria", "FEEDBACK", "MONITORING"),
  item("monitoria-com-ciencia", "FEEDBACK", "MONITORING", { acknowledgedAt: "2026-11-19T13:00:00.000Z" }),
  item("indicador", "FEEDBACK", "INDICATOR"),
  item("resultado", "ALERT", "WORKFLOW_OUTPUT"),
  item("revisao", "ALERT", "WORKFLOW_HUMAN_REVIEW"),
  item("escalonamento", "ALERT", "WORKFLOW_ESCALATION"),
  item("intervencao", "ALERT", "INTERVENTION"),
  item("outro-aviso", "ALERT", "OTHER"),
  item("report", "REPORT", "REPORT"),
  item("report-nao-encaminhado", "REPORT", "REPORT_NOT_FORWARDED"),
  item("comunicado-recebido", "NOTICE", "NOTICE", notice("diretora")),
  item("comunicado-publicado", "NOTICE", "NOTICE", notice(LEADER)),
  item("alinhamento", "ALIGNMENT", "ALIGNMENT"),
]

const query = (extra: Partial<FollowUpFeedQuery> = {}): FollowUpFeedQuery => ({ organizationId: ORG, viewerId: LEADER, operatorIds: ["op-1"], includeViewerAlerts: true, unacknowledgedOnly: false, limit: 50, before: null, ...extra })
const idsOf = async (extra: Partial<FollowUpFeedQuery> = {}) => (await new InMemoryAnalyticsRepository({ people: [], feed: FEED }).loadFollowUpFeed(query(extra))).items.map((entry) => entry.id).sort()

describe("feed em memória — filtro \"Tipo\"", () => {
  const expected: Record<FollowUpType, string[]> = {
    NOTICE: ["comunicado-publicado", "comunicado-recebido"],
    ALIGNMENT: ["alinhamento"],
    MONITORING: ["monitoria", "monitoria-com-ciencia"],
    INDICATOR: ["indicador"],
    WORKFLOW_OUTPUT: ["resultado"],
    HUMAN_REVIEW: ["revisao"],
    ESCALATION: ["escalonamento"],
    INTERVENTION: ["intervencao"],
    REPORT: ["report", "report-nao-encaminhado"],
    OTHER: ["outro-aviso"],
  }

  it.each(FOLLOW_UP_TYPES)("um tipo só: %s devolve só os itens daquele tipo", async (type) => {
    expect(await idsOf({ types: [type] })).toEqual(expected[type])
  })

  it("vários tipos somam; ausente, null ou vazio = sem filtro", async () => {
    expect(await idsOf({ types: ["ALIGNMENT", "INDICATOR", "OTHER"] })).toEqual(["alinhamento", "indicador", "outro-aviso"])
    const all = FEED.map((entry) => entry.id).sort()
    expect(await idsOf()).toEqual(all)
    expect(await idsOf({ types: null })).toEqual(all)
    expect(await idsOf({ types: [] })).toEqual(all)
  })

  it("todo item do feed pertence a exatamente um tipo do catálogo", () => {
    for (const entry of FEED) expect(FOLLOW_UP_TYPES).toContain(followUpTypeOf(entry))
    expect(new Set(FEED.map(followUpTypeOf))).toEqual(new Set(FOLLOW_UP_TYPES))
  })
})

describe("feed em memória — ciência e \"Para quem\"", () => {
  it("\"aguardando ciência\": só feedbacks sem ciência (avisos, reports, comunicados e alinhamentos saem), também combinado com o tipo", async () => {
    expect(await idsOf({ unacknowledgedOnly: true })).toEqual(["indicador", "monitoria"])
    expect(await idsOf({ unacknowledgedOnly: true, types: ["MONITORING"] })).toEqual(["monitoria"])
    expect(await idsOf({ unacknowledgedOnly: true, types: ["ALIGNMENT", "REPORT"] })).toEqual([])
  })

  it("alinhamento é da equipe: aparece em TEAM e sai em MINE", async () => {
    expect(await idsOf({ audience: "TEAM", types: ["ALIGNMENT", "NOTICE"] })).toEqual(["alinhamento", "comunicado-publicado"])
    expect(await idsOf({ audience: "MINE", types: ["ALIGNMENT", "NOTICE"] })).toEqual(["comunicado-recebido"])
  })
})
