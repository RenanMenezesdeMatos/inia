import { describe, expect, it, vi } from "vitest"
import { loadPublicationComplianceSources } from "./publication-compliance-sources.js"

/** Fontes PUBLICATION da conferência (V6): o texto do registro publicado, pelo id, nunca texto de IA; nada pedido = nenhuma consulta. */
describe("comunicados e alinhamentos como fonte da conferência", () => {
  it("monta cada fonte com o título, o autor e o texto do comunicado; o alinhamento com referência, público, vigência, quem definiu, trecho, orientação e motivo", async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      expect(params[0]).toBe("org")
      if (sql.includes("from communications")) return { rows: [{ title: "Festa de fim de ano", plain_text: "Será no dia 23/11.", summary: null, published_at: new Date("2026-11-17T15:00:00Z"), author: "Renan" }] }
      return { rows: [{ alignment_id: "aaaaaaaa-0000-4000-8000-000000000001", version: 2, title: "Fatura pelo App", guidance: "Oriente o App.", affected_topic: "Envio da fatura", justification: "Troca do sistema.", starts_on: "2026-11-10", ends_on: "2026-11-30", operating_universe: "B2C", scope_type: "GROUPS", links: [{ teamId: "t1", teamName: "Ouvidoria", subteamId: null, subteamName: null }], product_name: null, responsible_name: "Ana Souza", responsible_job_title: "Supervisora", published_by_name: "Bruno", published_by_job_title: null }] }
    })
    const sources = await loadPublicationComplianceSources({ query } as never, "org", { communicationIds: ["c1"], alignmentVersionIds: ["v1"] })
    expect(sources).toEqual([
      { origin: "PUBLICATION", title: "Comunicado: Festa de fim de ano", text: "Publicado por Renan em 17/11/2026.\nSerá no dia 23/11." },
      { origin: "PUBLICATION", title: "Alinhamento operacional: Fatura pelo App", text: "Referência: AO-AAAAAAAA v2.\nPúblico: B2C · Grupo Ouvidoria.\nVigência: 10/11/2026 a 30/11/2026 (orientação temporária).\nDefinido por: Ana Souza (Supervisora).\nTrecho que muda: Envio da fatura\nOrientação: Oriente o App.\nMotivo: Troca do sistema." },
    ])
  })

  it("sem nada nas instruções, não consulta o banco", async () => {
    const query = vi.fn()
    expect(await loadPublicationComplianceSources({ query } as never, "org", { communicationIds: [], alignmentVersionIds: [] })).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })
})
