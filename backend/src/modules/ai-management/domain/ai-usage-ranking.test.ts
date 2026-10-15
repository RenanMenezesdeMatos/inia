import { describe, expect, it } from "vitest"
import type { AccessContext } from "../../access/domain/access-decision.js"
import { aiPermissionsFor } from "./ai-permissions.js"
import { aiUsageRankingQuerySchema, shareOf } from "./ai-usage-ranking.js"

const access = (assignments: AccessContext["assignments"]): AccessContext => ({ organizationId: "org", accountId: "acc", personId: "p", assignments })

describe("ranking 'Quem mais usa' — permissão explícita", () => {
  it("Administrador geral e Administrador (em qualquer escopo) recebem o ranking pela concessão ai.usage_ranking.view do papel", () => {
    expect(aiPermissionsFor(access([{ id: "1", roleCode: "ADMINISTRADOR_GERAL", scope: { type: "ORGANIZATION" } }]))).toContain("AI_USAGE_RANKING_READ")
    expect(aiPermissionsFor(access([{ id: "1", roleCode: "ADMINISTRADOR", scope: { type: "SUBGROUP", subteamId: "s1", teamId: "t1" } }]))).toEqual(["AI_CONFIG_READ", "AI_USAGE_READ", "AI_USAGE_RANKING_READ"])
  })

  it("sem a permissão não há ranking — nem para quem administra acessos, lê usabilidade ou conversas (deny by default)", () => {
    for (const roleCode of ["ADMINISTRADOR_DE_ACESSOS", "LEITOR_DE_USABILIDADE", "ANALISTA_DE_USABILIDADE", "LEITOR_DE_CONVERSAS_INIA", "QA_DE_FEEDBACK"]) {
      expect(aiPermissionsFor(access([{ id: "1", roleCode, scope: { type: "ORGANIZATION" } }]))).not.toContain("AI_USAGE_RANKING_READ")
    }
    expect(aiPermissionsFor(access([]))).toEqual([])
  })
})

describe("ranking 'Quem mais usa' — filtros validados no servidor", () => {
  it("padrões: Diretoria, 30 dias, por chamadas, página 1 de 20", () => {
    expect(aiUsageRankingQuerySchema.parse({})).toMatchObject({ level: "DIRECTOR", period: "30D", sort: "REQUESTS", page: 1, pageSize: 20 })
  })

  it("recusa parâmetro desconhecido, texto livre, nível fora do catálogo, id que não é opaco e página grande demais", () => {
    for (const invalid of [{ search: "Ana" }, { personName: "Ana" }, { level: "COORDINATOR" }, { teamId: "Norte" }, { subteamId: "1" }, { pageSize: "101" }, { page: "0" }, { providerKey: "gemini; drop" }, { useCase: "chat" }]) {
      expect(aiUsageRankingQuerySchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false)
    }
  })

  it("participação com 1 casa; total zero nunca vira 0%", () => {
    expect(shareOf(5, 12)).toBe(41.7)
    expect(shareOf(0, 0)).toBeNull()
  })
})
